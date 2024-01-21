import Debug from 'debug';
import path from 'path';
import type * as Td from 'tdlib-types';

import { loadAddon } from './addon.ts';
import { Client, type StrictClientOptions, type Tdjson, TdlError } from './client.ts';
import { deepRenameKey } from './util.ts';

const debug = Debug('tdl');

let tdjsonAddon: Tdjson | null = null;

type LibraryFile = 'tdjson.dll' | 'libtdjson.dylib' | 'libtdjson.so';

// TODO: Should we export this?
const defaultLibraryFile = ((): LibraryFile => {
  switch (process.platform) {
    case 'win32':
      return 'tdjson.dll';
    case 'darwin':
      return 'libtdjson.dylib';
    default:
      return 'libtdjson.so';
  }
})();

export type TDLibConfiguration = {
  tdjson?: string;
  libdir?: string;
  verbosityLevel?: number | 'default';
  receiveTimeout?: number;
  useNewTdjsonInterface?: boolean;
};

// TODO: Use Required<T> from new Flow versions
type StrictTDLibConfiguration = {
  tdjson: string;
  libdir: string;
  verbosityLevel: number | 'default';
  receiveTimeout: number;
  useNewTdjsonInterface: boolean;
};

const defaultReceiveTimeout = 10;

const cfg: StrictTDLibConfiguration = {
  tdjson: defaultLibraryFile,
  libdir: '',
  verbosityLevel: 2,
  receiveTimeout: defaultReceiveTimeout,
  useNewTdjsonInterface: false,
};

export function configure(opts: TDLibConfiguration = {}): void {
  if (tdjsonAddon) throw Error('TDLib is already initialized; too late to configure');
  if (opts.tdjson != null) cfg.tdjson = opts.tdjson;
  if (opts.libdir != null) cfg.libdir = opts.libdir;
  if (opts.verbosityLevel != null) cfg.verbosityLevel = opts.verbosityLevel;
  if (opts.receiveTimeout != null) cfg.receiveTimeout = opts.receiveTimeout;
  if (opts.useNewTdjsonInterface != null) cfg.useNewTdjsonInterface = opts.useNewTdjsonInterface;
}

export const init = async (): Promise<void> => {
  if (tdjsonAddon) return;
  debug('Initializing the node addon');
  const lib = path.join(cfg.libdir, cfg.tdjson);
  tdjsonAddon = await loadAddon(lib);
  if (cfg.verbosityLevel !== 'default') {
    debug('Executing setLogVerbosityLevel', cfg.verbosityLevel);
    const request = JSON.stringify({
      '@type': 'setLogVerbosityLevel',
      new_verbosity_level: cfg.verbosityLevel,
    });
    if (cfg.useNewTdjsonInterface) tdjsonAddon.tdn.execute(request);
    else tdjsonAddon.execute(null, request);
  }
};

export const execute: Td.Execute = request => {
  if (!tdjsonAddon) {
    init();
    if (!tdjsonAddon) throw Error('TDLib is uninitialized');
  }
  debug('execute', request);
  const newRequest = JSON.stringify(deepRenameKey('_', '@type', request));
  const response = cfg.useNewTdjsonInterface
    ? tdjsonAddon.tdn.execute(newRequest)
    : tdjsonAddon.execute(null, newRequest);
  if (response == null) return null;
  return deepRenameKey('@type', '_', JSON.parse(response));
};

export const setLogMessageCallback = async (
  maxVerbosityLevel: number,
  callback: null | ((verbosityLevel: number, message: string) => void),
): Promise<void> => {
  if (!tdjsonAddon) {
    await init();
    if (!tdjsonAddon) throw Error('TDLib is uninitialized');
  }
  tdjsonAddon.setLogMessageCallback(maxVerbosityLevel, callback);
};

const clientMap: Map<number, Client> = new Map();
let tdnInitialized = false;
let runningReceiveLoop = false;

// Loop for the new tdjson interface
const receiveLoop = async (): Promise<void> => {
  debug('Starting receive loop');
  runningReceiveLoop = true;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (clientMap.size < 1) {
        debug('Stopping receive loop');
        break;
      }
      // $FlowIgnore[incompatible-use]
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const responseString = await tdjsonAddon.tdn.receive();
      // console.log('running receiveLoop');

      if (responseString == null) {
        debug('Receive loop: got empty response');
        continue;
      }
      const res = JSON.parse(responseString);
      const clientId = res['@client_id'];
      const client = clientId != null ? clientMap.get(clientId) : undefined;
      if (client == null) {
        debug(`Cannot find client_id ${clientId}`);
        continue;
      }
      delete res['@client_id']; // Note that delete is somewhat slow
      client.handleReceive(res);
    }
  } finally {
    runningReceiveLoop = false;
  }
};

export const createClient = async (opts: Partial<StrictClientOptions>): Promise<Client> => {
  if (!tdjsonAddon) {
    await init();
    if (!tdjsonAddon) throw Error('TDLib is uninitialized');
  }
  if (cfg.useNewTdjsonInterface) {
    if (!tdnInitialized) {
      tdjsonAddon.tdn.init(cfg.receiveTimeout);
      tdnInitialized = true;
    }
    const onClose = (): void => {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      debug(`Deleting client_id ${clientId}`);
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      clientMap.delete(clientId);
    };
    const client = new Client(tdjsonAddon, opts, { useTdn: true, onClose });
    const clientId = client.getClientId();
    clientMap.set(clientId, client);

    if (!runningReceiveLoop) receiveLoop();
    return client;
  }
  if (cfg.receiveTimeout !== defaultReceiveTimeout)
    return new Client(tdjsonAddon, { ...opts, receiveTimeout: cfg.receiveTimeout });
  return new Client(tdjsonAddon, opts);
};

// TODO: We could possibly export an unsafe/unstable getRawTdjson() : Tdjson
// function that allows to access underlying tdjson functions

export { TdlError };

// For backward compatibility only.
export { Client, Client as TDL, Client as Tdl };
