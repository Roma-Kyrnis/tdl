import { createWriteStream } from 'node:fs';
import path from 'node:path';

const LOGGER_FILENAME = 'tdl.log';
const pathToLogFile = path.join(process.cwd(), LOGGER_FILENAME);

export const createLogger = (logName: string): ((...data: any) => void) => {
  const writeStream = createWriteStream(pathToLogFile);
  return (...data) => {
    writeStream.write(`${logName}:\n`);
    writeStream.write(JSON.stringify(data));
    writeStream.write(`\n`);
  };
};
