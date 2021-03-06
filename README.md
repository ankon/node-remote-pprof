# node-remote-pprof

Library that implements the [google-perftools remote interface](http://gperftools.github.io/gperftools/pprof_remote_servers.html) as a Express/Connect-compatible router.

## Installation

```sh
npm install --save node-remote-pprof
```

## Usage

1. Add the `/pprof` endpoint to your application

   ```js
   const express = require('express');
   const pprof = require('node-remote-pprof');

   const app = express();

   app.use('/pprof', pprof());

   app.listen(3000);
   ```

2. Run the application
   ```sh
   node --perf-basic-prof .../app.js
   ```

   The `--perf-basic-prof` command-line is needed for resolving Javascript symbols dynamically.

3. Use the `pprof` tool to profile the application
   ```sh
   pprof --web localhost:3000
   ```
   
   Note: Either the original `pprof` or [the go version](https://github.com/google/pprof) should work here.

## Environment

This library is very rough, and only got light testing on mac OS High Sierra and some Linux derivates. Expect bugs and missing features.

By default the application will run with heap profiling disabled, this can be controlled by settingthe `HEAPPROFILE` environment variable to the prefix of the heap dumps to create.

Alpine Linux/musl is not supported right now: See https://github.com/gperftools/gperftools/issues/693 for details and further links.

## License

Apache-2.0.


