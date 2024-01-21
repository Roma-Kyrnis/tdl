/** Not use webpack parser because it's abounded from source node-gyp-build module */
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

type ProcessConfigCustom = NodeJS.ProcessConfig & { variables: { readonly arm_version: string } };

type Tuple = {
  name: string;
  platform: string;
  architectures: string[];
};

type FileTags = {
  file: string;
  specificity: number;
  runtime?: 'node' | 'electron' | 'node-webkit';
  napi?: boolean;
  abi?: string;
  uv?: string;
  armv?: string;
  libc?: 'glibc' | 'musl';
};

type MatchBuild = (name: string) => boolean;

const isAlpine = (platform: string): boolean =>
  platform === 'linux' && existsSync('/etc/alpine-release');

const isElectron = (): boolean => {
  if (process.versions?.electron) return true;
  if (process.env.ELECTRON_RUN_AS_NODE) return true;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  return typeof window !== 'undefined' && window.process && window.process.type === 'renderer';
};

const isNwjs = (): boolean => !!process.versions?.nw;

const vars = (process.config as ProcessConfigCustom)?.variables ?? {};
const prebuildsOnly = !!process.env.PREBUILDS_ONLY;
const abi = process.versions.modules; // TODO: support old node where this is undef
const runtimeNwjs = isNwjs() ? 'node-webkit' : 'node';
const runtime = isElectron() ? 'electron' : runtimeNwjs;

const arch = process.env.npm_config_arch ?? os.arch();
const platform = process.env.npm_config_platform ?? os.platform();
const libc = process.env.LIBC ?? (isAlpine(platform) ? 'musl' : 'glibc');
const armv = process.env.ARM_VERSION ?? (arch === 'arm64' ? '8' : vars?.arm_version) ?? '';
const uv = (process.versions.uv || '').split('.')[0];

const matchBuild: MatchBuild = name => name.endsWith('.node');

const parseTuple = (name: string): Tuple | undefined => {
  // Example: darwin-x64+arm64
  const arr = name.split('-');
  if (arr.length !== 2) return;

  const platform = arr[0];
  const architectures = arr[1].split('+');

  if (!platform) return;
  if (!architectures.length) return;
  if (!architectures.every(Boolean)) return;

  return { name, platform, architectures };
};

const matchTuple =
  (platform: string, arch: string): ((tuple?: Tuple) => boolean) =>
  (tuple: Tuple | undefined) => {
    if (tuple == null) return false;
    if (tuple.platform !== platform) return false;
    return tuple.architectures.includes(arch);
  };

const compareTuples = (a?: Tuple, b?: Tuple): number => {
  if (!a || !b) return (!a && !b) || !b ? 0 : -1;
  // Prefer single-arch prebuilds over multi-arch
  return a.architectures.length - b.architectures.length;
};

const parseTags = (file: string): FileTags | undefined => {
  const arr = file.split('.');
  const extension = arr.pop();
  const tags: FileTags = { file: file, specificity: 0 };

  if (extension !== 'node') return;

  for (const tag of arr) {
    if (tag === 'node' || tag === 'electron' || tag === 'node-webkit') {
      tags.runtime = tag;
    } else if (tag === 'napi') {
      tags.napi = true;
    } else if (tag.startsWith('abi')) {
      tags.abi = tag.slice(3);
    } else if (tag.startsWith('uv')) {
      tags.uv = tag.slice(2);
    } else if (tag.startsWith('armv')) {
      tags.armv = tag.slice(4);
    } else if (tag === 'glibc' || tag === 'musl') {
      tags.libc = tag;
    } else {
      continue;
    }

    tags.specificity++;
  }

  return tags;
};

const runtimeAgnostic = (tags: FileTags): boolean | undefined =>
  tags.runtime === 'node' && tags.napi;

const matchTags =
  (runtime: string, abi: string) =>
  (tags: FileTags | undefined): boolean => {
    if (tags == null) return false;
    if (tags.runtime && tags.runtime !== runtime && !runtimeAgnostic(tags)) return false;
    if (tags.abi && tags.abi !== abi && !tags.napi) return false;
    if (tags.uv && tags.uv !== uv) return false;
    if (tags.armv && tags.armv !== armv) return false;
    if (tags.libc && tags.libc !== libc) return false;

    return true;
  };

const compareTags =
  (runtime: string): ((a?: FileTags, b?: FileTags) => -1 | 0 | 1) =>
  // Precedence: non-agnostic runtime, abi over napi, then by specificity.
  (a, b) => {
    if (!a || !b) return (!a && !b) || !b ? 0 : -1;
    if (a.runtime !== b.runtime) {
      return a.runtime === runtime ? -1 : 1;
    } else if (a.abi !== b.abi) {
      return a.abi ? -1 : 1;
    } else if (a.specificity !== b.specificity) {
      return a.specificity > b.specificity ? -1 : 1;
    } else {
      return 0;
    }
  };

const resolve = async (dir: string): Promise<string | undefined> => {
  // Find matching "prebuilds/<platform>-<arch>" directory
  const tuplesStrings = await readdir(path.join(dir, 'prebuilds'));
  const tuple = tuplesStrings
    .map(parseTuple)
    .filter(matchTuple(platform, arch))
    .sort(compareTuples)[0];
  if (!tuple) return;

  // Find most specific flavor first
  const prebuilds = path.join(dir, 'prebuilds', tuple.name);
  const parsedStrings = await readdir(prebuilds);
  const parsed = parsedStrings.map(parseTags);
  const candidates = parsed.filter(matchTags(runtime, abi));
  const winner = candidates.toSorted(compareTags(runtime))[0];
  if (winner) return path.join(prebuilds, winner.file);
};

const getFirst = async (dir: string, filter: MatchBuild): Promise<string | undefined> => {
  const files = await readdir(dir);
  const filesFiltered = files.filter(filter);
  return filesFiltered[0] && path.join(dir, filesFiltered[0]);
};

const loadResolve = async (pathToDir: string): Promise<string> => {
  let dir = pathToDir;

  try {
    const pathToPackageJson = path.join(dir, 'package.json');
    if (existsSync(pathToPackageJson)) {
      const name = require(pathToPackageJson).name.toUpperCase().replace(/-/g, '_');

      if (process.env[name + '_PREBUILD']) dir = process.env[name + '_PREBUILD'] as string;
    }
    // eslint-disable-next-line no-empty
  } catch (err) {}

  if (!prebuildsOnly) {
    try {
      const release = await getFirst(path.join(dir, 'build/Release'), matchBuild);
      if (release) return release;
      // eslint-disable-next-line no-empty
    } catch (error) {}

    try {
      const debug = await getFirst(path.join(dir, 'build/Debug'), matchBuild);
      if (debug) return debug;
      // eslint-disable-next-line no-empty
    } catch (error) {}
  }

  try {
    const prebuild = await resolve(dir);
    console.log({ prebuild, dir });

    if (prebuild) return prebuild;
    // eslint-disable-next-line no-empty
  } catch (error) {}

  try {
    const nearby = await resolve(path.dirname(process.execPath));
    if (nearby) return nearby;
    // eslint-disable-next-line no-empty
  } catch (error) {}

  const target = [
    'platform=' + platform,
    'arch=' + arch,
    'runtime=' + runtime,
    'abi=' + abi,
    'uv=' + uv,
    armv ? 'armv=' + armv : '',
    'libc=' + libc,
    'node=' + process.versions.node,
    process.versions.electron ? 'electron=' + process.versions.electron : '',
  ]
    .filter(Boolean)
    .join(' ');

  throw new Error('No native build was found for ' + target + '\n    loaded from: ' + dir + '\n');
};

export const nodeGypBuild = async (dir: string): Promise<any> => {
  const res = await loadResolve(dir);
  return require(res);
};
