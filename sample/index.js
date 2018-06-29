#!/usr/bin/env node

'use strict';

const http = require('http');

const finalhandler = require('finalhandler');
const Router = require('router');
const uuidV4 = require('uuid/v4');

const {pprof} = require('..');
const router = Router();
router.use('/pprof', pprof());
router.get('/endpoint', (req, res) => {
	// Generate some traffic: Calculate 5000 uuids, return them all.
	res.statusCode = 200;
	for (let i = 0; i < 5000; i++) {
		res.write(uuidV4());
	}
	res.end();
});

const server = http.createServer((req, res) => {
	router(req, res, finalhandler(req, res));
});

server.listen(process.env.PORT || 3000);
