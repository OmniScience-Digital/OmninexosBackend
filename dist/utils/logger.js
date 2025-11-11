import pino from 'pino';
const pinoLogger = pino({
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'yyyy-mm-dd HH:MM:ss', // This will show full date and time
            ignore: 'pid,hostname',
        },
    },
    base: {
        pid: false,
    },
    timestamp: pino.stdTimeFunctions.isoTime, // Use ISO time format
});
// Custom logger that handles both old and new pino signatures
const logger = {
    info: (msg, ...args) => {
        if (args.length > 0) {
            if (typeof args[0] === 'string') {
                pinoLogger.info(`${msg} ${args[0]}`);
            }
            else if (typeof args[0] === 'object') {
                pinoLogger.info({ ...args[0] }, msg);
            }
            else {
                pinoLogger.info(msg, ...args);
            }
        }
        else {
            pinoLogger.info(msg);
        }
    },
    // In your customLogger.ts - update the warn method:
    warn: (msg, ...args) => {
        if (typeof msg === 'object') {
            // Handle case where only object is passed
            pinoLogger.warn(msg);
        }
        else if (args.length > 0) {
            if (typeof args[0] === 'string') {
                pinoLogger.warn(`${msg} ${args[0]}`);
            }
            else if (typeof args[0] === 'object') {
                pinoLogger.warn({ ...args[0] }, msg);
            }
            else {
                pinoLogger.warn(msg, ...args);
            }
        }
        else {
            pinoLogger.warn(msg);
        }
    },
    error: (msg, ...args) => {
        if (args.length > 0) {
            if (typeof args[0] === 'string') {
                pinoLogger.error(`${msg} ${args[0]}`);
            }
            else if (typeof args[0] === 'object') {
                pinoLogger.error({ ...args[0] }, msg);
            }
            else if (args[0] instanceof Error) {
                pinoLogger.error(args[0], msg);
            }
            else {
                pinoLogger.error(msg, ...args);
            }
        }
        else {
            pinoLogger.error(msg);
        }
    },
    debug: (msg, ...args) => {
        if (args.length > 0) {
            if (typeof args[0] === 'string') {
                pinoLogger.debug(`${msg} ${args[0]}`);
            }
            else if (typeof args[0] === 'object') {
                pinoLogger.debug({ ...args[0] }, msg);
            }
            else {
                pinoLogger.debug(msg, ...args);
            }
        }
        else {
            pinoLogger.debug(msg);
        }
    },
};
export default logger;
