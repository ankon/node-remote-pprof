/**
 * Express-compatible router/endpoints for supporting the gperftools "remote" functionality.
 *
 * This is based on the description in http://gperftools.github.io/gperftools/pprof_remote_servers.html,
 * and right now is incomplete, sketchy, slow, and likely only useful in our context.
 */
const gperftools = require('bindings')('addon.node');

const fs = require('fs');
const url = require('url');
const {spawn} = require('child_process');

const {tmpName} = require('tmp');
const {sortedIndexBy} = require('lodash');

const pump = require('pump');

const Router = require('router');

const logger = require('@log4js-node/log4js-api').getLogger('pprof');

/** Map of resolved addresses to symbols (function name, or location, or empty if unknown) */
const symbolCache = new Map();

function spawnHelper(command, args) {
	return new Promise((resolve, reject) => {
		const p = spawn(command, args);

		const chunks = [];
		const errorChunks = [];

		p.stdout.on('data', data => {
			chunks.push(data);
		});

		p.stderr.on('data', data => {
			errorChunks.push(data);
		});

		p.on('error', err => {
			return reject(err);
		});
		p.on('close', code => {
			if (code === 0) {
				return resolve(chunks.join(''));
			}

			return reject(new Error(`Cannot run ${command}: Returned ${code}`));
		});
	});
}

/**
 * Determine the symbolic locations for the given addresses in the current program.
 *
 */
/* Implementation note: Right now this forks and calls addr2line(1) on our own executable. Probably it is possible
 * inline that into a native extension and call whatever functions addr2line calls.
 */
async function addr2line(addresses) {
	const output = await spawnHelper('addr2line', ['-C', '-f', '-s', '-e', '/proc/self/exe', ...addresses]);

	// Things worked, so split stuff: We get two lines of output per address.
	// The first line is the function, or '??', the second is the location (could also be '??:0' or '??:?' even)
	let lastFunction;
	const symbols = output.split('\n').reduce((agg, line, index) => {
		if (index % 2 === 0) {
			lastFunction = line;
		} else {
			const address = addresses[index / 2];
			let symbol;
			if (lastFunction === '??') {
				if (line === '??:0' || line === '??:?') {
					symbol = '';
				} else {
					symbol = line;
				}
			} else {
				symbol = lastFunction;
			}
			agg[address] = symbol;
		}
		return agg;
	}, {});

	return symbols;
}

// Implementation node: Parsing is rough and based on handwaving.
// XXX: Also look at https://github.com/google/pprof/issues/351 and try to follow their implementation (or provide it)
async function atos(addresses) {
	const output = await spawnHelper('atos', ['-p', process.pid, ...addresses]);

	// Format seems to be "SYMBOLIC_NAME \(in MODULE\) (+ INDEX|\(FILENAME:LINE\))", or the input address.
	const atosLineMatcher = /(.+) \(in (.+)\) (\+ (\d+)|\(.+\))/;
	const symbols = output.split('\n').reduce((agg, symbolInformation, index) => {
		const address = addresses[index];

		const match = atosLineMatcher.exec(symbolInformation);
		if (match) {
			agg[address] = match[1];
		} else {
			agg[address] = symbolInformation;
		}
		return agg;
	}, {});

	return symbols;
}

function resolveAddressesWithPerf(addresses, {merge} = {merge: false}) {
	return new Promise((resolve, reject) => {
		const symbols = {};
		const perfMapPath = `/tmp/perf-${process.pid}.map`;
		fs.exists(perfMapPath, exists => {
			if (!exists) {
				return resolve({
					missingAddresses: addresses,
					symbols,
				});
			}

			return fs.readFile(perfMapPath, 'utf8', (err, data) => {
				if (err) {
					return reject(err);
				}

				function overlaps(symbolSpec1, symbolSpec2) {
					if (symbolSpec1.start >= symbolSpec2.start && symbolSpec1.start < symbolSpec2.start + symbolSpec2.len) {
						return true;
					}
					if (symbolSpec1.start + symbolSpec1.len >= symbolSpec2.start && symbolSpec1.start + symbolSpec1.len < symbolSpec2.start + symbolSpec2.len) {
						return true;
					}

					return false;
				}

				// Data is lines of 'start length symbol [location]'
				// Load these, and sort them ascending.
				// Note that it is possible that a later symbol overwrites an earlier one, so we have to check whether the
				// index _before_ or _after_ would be overlapping the new symbol, and if so remove these.

				// For looking up the symbol "right now" the overwriting is the correct approach. But, when looking at profiles
				// taken over an amount of time (either multiple heap profiles, or a cpu profile), we will see likely see multiple versions
				// of the same symbol, depending on whether and how often it got moved between those profiles.
				const sortedSymbolSpecs = [];
				const perfMapLineMatcher = /([0-9a-f]+) ([0-9a-f]+) ([^ ]+)( (.+))?/;
				data.split('\n').forEach(line => {
					const match = perfMapLineMatcher.exec(line);
					if (match) {
						const newSymbolSpec = {
							len: Number.parseInt(match[2], 16),
							location: match[4],
							start: Number.parseInt(match[1], 16),
							symbol: match[3],
						};
						let insertAt = sortedIndexBy(sortedSymbolSpecs, newSymbolSpec, symbolSpec => symbolSpec.start);
						let deleteCount = 0;
						if (merge) {
							if (insertAt > 0 && sortedSymbolSpecs[insertAt - 1].start + sortedSymbolSpecs[insertAt - 1].len > newSymbolSpec.start) {
								insertAt--;
								deleteCount++;
							}
							while (insertAt + deleteCount + 1 < sortedSymbolSpecs.length && overlaps(sortedSymbolSpecs[insertAt + deleteCount + 1], newSymbolSpec)) {
								deleteCount++;
							}
						} else if (insertAt + 1 < sortedSymbolSpecs.length && newSymbolSpec.start === sortedSymbolSpecs[insertAt + 1].start) {
							// Guarantee at most one symbol per address.
							logger.warn(`Symbol ${newSymbolSpec.symbol} moved over previous symbol ${sortedSymbolSpecs[insertAt + 1].symbol} at ${newSymbolSpec.start}, but not merging`);
							deleteCount = 1;
						}
						sortedSymbolSpecs.splice(insertAt, deleteCount, newSymbolSpec);
					}
				});

				// Sort the needed addresses ascending
				addresses.sort();

				// Iterate and match
				const missingAddresses = [];
				let addressIndex = 0;
				let symbolIndex = 0;
				while (addressIndex < addresses.length && symbolIndex < sortedSymbolSpecs.length) {
					const address = addresses[addressIndex];
					const parsedAddress = Number.parseInt(address.substring(2), 16);
					while (symbolIndex + 1 < sortedSymbolSpecs.length && parsedAddress > sortedSymbolSpecs[symbolIndex + 1].start) {
						symbolIndex++;
					}
					const potentialSymbol = sortedSymbolSpecs[symbolIndex];
					if (symbolIndex < sortedSymbolSpecs.length && parsedAddress > potentialSymbol.start && parsedAddress < potentialSymbol.start + potentialSymbol.len) {
						// Found one!
						symbols[address] = sortedSymbolSpecs[symbolIndex].symbol || sortedSymbolSpecs[symbolIndex].location;
					} else {
						// Not known, leave over.
						missingAddresses.push(address);
					}
					addressIndex++;
				}
				addresses.slice(addressIndex).forEach(address => missingAddresses.push(address));
				return resolve({
					missingAddresses,
					symbols,
				});
			});
		});
	});
}

async function resolveAddresses(addresses) {
	// For addresses already resolved: Use that information.
	const result = new Map();
	const newAddresses = [];
	addresses.forEach(address => {
		const symbol = symbolCache.get(address);
		if (typeof symbol === 'string') {
			result.set(address, symbol);
		} else {
			newAddresses.push(address);
		}
	});

	const {symbols, missingAddresses} = await resolveAddressesWithPerf(newAddresses);
	if (missingAddresses.length > 0) {
		try {
			const resolvedSymbols = process.platform === 'darwin' ? await atos(missingAddresses) : await addr2line(missingAddresses);
			Object.assign(symbols, resolvedSymbols);
		} catch (err) {
			logger.warn(`Cannot resolve ${missingAddresses.length} symbols: ${err.message}`);
		}
	}

	Object.keys(symbols).forEach(address => {
		const symbol = symbols[address];
		symbolCache.set(address, symbol);
		result.set(address, symbol);
	});

	return result;
}

function notImplemented(req, res) {
	res.statusCode = 501;
	res.end('Not implemented');
}

function getHeap(req, res) {
	try {
		const profile = gperftools.GetHeapProfile();
		res.statusCode = 200;
		res.end(profile);
	} catch (err) {
		logger.warn(`Cannot get heap profile: ${err.message}`);
		res.statusCode = 500;
		res.end(err.message);
	}
}

function getGrowth(req, res) {
	try {
		const heapGrowthStacks = gperftools.GetHeapGrowthStacks();
		res.statusCode = 200;
		res.end(heapGrowthStacks);
	} catch (err) {
		logger.warn(`Cannot get growth profile: ${err.message}`);
		res.statusCode = 500;
		res.end(err.message);
	}
}

function getProfile(req, res) {
	const {query} = url.parse(req.url, true);

	// TODO: Check whether the profiler is currently running
	const state = gperftools.ProfilerGetCurrentState();
	if (state.enabled) {
		logger.warn(`Profiler already running since ${state.startTime} (${state.profileName}, ${state.samplesGathered} samples gathered)`);
		res.statusCode = 409;
		res.end(`Profiler already running since ${state.startTime}`);
		return;
	}
	tmpName((err, path) => {
		if (err) {
			logger.warn(`Cannot create profile: ${err.message}`);
			res.statusCode = 500;
			res.end(err.message);
			return;
		}

		if (!gperftools.ProfilerStart(path)) {
			logger.warn('Cannot start profiling');
			res.statusCode = 500;
			res.end('Cannot start profiling');
			return;
		}
		setTimeout(() => {
			gperftools.ProfilerStop();
			pump(fs.createReadStream(path), res);
		}, query.seconds * 1000);
	});
}

function getCmdline(req, res) {
	// Parsing /proc/self/cmdline only works on Linux, so simulate it natively.
	res.statusCode = 200;
	res.end([process.execPath, ...process.execArgv, ...process.argv.slice(1)].join('\n'));
}

function getNumSymbols(req, res) {
	// "For now, the only important distinction is whether the value is 0, which it is for executables that lack debug information, or not-0"
	// Assume we have debug information, so return a non-0 value.
	const numSymbols = 1;

	res.statusCode = 200;
	res.end(`num_symbols: ${numSymbols}`);
}

async function postSymbol(req, res) {
	const bodyChunks = [];
	req.on('data', data => {
		bodyChunks.push(data);
	});
	req.on('end', async() => {
		const addresses = bodyChunks.join('').split('+');

		const resolved = await resolveAddresses(addresses);
		res.statusCode = 200;
		const output = Array.from(resolved.entries()).map(keyValue => `${keyValue[0]}\t${keyValue[1]}`).join('\n');
		res.end(output);
	});
}

/**
 * Create a Express-compatible router.
 *
 * Should be used with `use`:
 * ```js
 * app.use('/pprof', pprof());
 * ```
 *
 * @return {Router} a router handling the /pprof requests
 */
function pprof() {
	const router = Router({});
	router.get('/heap', getHeap);
	router.get('/growth', getGrowth);
	router.get('/profile', getProfile);
	router.get('/pmuprofile', notImplemented);
	router.get('/contention', notImplemented);
	router.get('/cmdline', getCmdline);
	router.get('/symbol', getNumSymbols);
	router.post('/symbol', postSymbol);

	// Note: The golang pprof remote support uses different paths:
	// /symbolz: same as /pprof/symbol
	return router;
}

module.exports = pprof;
