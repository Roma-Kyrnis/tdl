import path from 'path';

import { nodeGypBuild } from './utils/nodeGypBuild';
import type { Tdjson } from './client.ts';

const packageDir = process.cwd();
// const packageDir = path.join(process.cwd(), 'src', 'tdl', 'module');

let loaded = false;

export const loadAddon = async (libraryFile: string): Promise<Tdjson> => {
  if (loaded) throw Error('The node addon is already loaded');
  const addon = await nodeGypBuild(packageDir);
  addon.loadTdjson(libraryFile);
  loaded = true;
  return {
    create: addon.create,
    send: addon.send,
    receive: addon.receive,
    execute: addon.execute,
    destroy: addon.destroy,
    setLogFatalErrorCallback: addon.setLogFatalErrorCallback,
    setLogMessageCallback: addon.setLogMessageCallback,
    tdn: {
      init: addon.tdnInit,
      createClientId: addon.tdnCreateClientId,
      send: addon.tdnSend,
      receive: addon.tdnReceive,
      execute: addon.tdnExecute,
    },
  };
};
