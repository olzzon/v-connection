"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const msehttp_1 = require("../msehttp");
const yargs = require("yargs");
let args = yargs
    .string('profile')
    .string('host')
    .number('port')
    .demandCommand(2, 2)
    .default('profile', 'MOSART')
    .default('host', 'localhost')
    .default('port', 8580)
    .argv;
async function run() {
    try {
        let http = msehttp_1.createHTTPContext(args.profile, args.host, args.port);
        let res = await http.command(args._[0], args._[1]);
        console.log(res);
    }
    catch (err) {
        console.error(err);
    }
}
run().catch(err => console.error('Uncaught error', err));
//# sourceMappingURL=httpcommand.js.map