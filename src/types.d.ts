declare module 'delcom-client';
import fs from 'node:fs';
import type * as DCST from 'delcom-server';

export type CallbackWithErr = (arg0?: { err: string }) => void;

// client listener types
export type JobInfo = {
  dir: fs.PathLike;
  writeStreams: { [key: string]: fs.WriteStream };
};

export type ResultInfo = {
  dir: fs.PathLike;
  writeStreams: { [key: string]: fs.WriteStream };
  finishPromise: {
    promise?: Promise<void>;
    res?: () => void;
    rej?: (arg0?: unknown) => void;
  };
};

export type Config = {
  ip: string; // ip of server
  port: number; // port of server
  id: string; // unique ID
  delcomTempDir?: string;
  isWorking: boolean; // if the client is currently working
  isDelegating: boolean; // if the client is currently working
  isWorker: boolean; // if the client is willing to work
  workerInfo: DCST.WorkerInfo;
  job?: JobInfo; // info about current job
  res?: ResultInfo; // info about job results
};

// Client Listener Functions

export type ReceiveFileDataArg = { name: string; chunk: string | Buffer };

export type GetConfigAckCB = (arg0: Config) => void;

export class Client {
  constructor(ip: string, port: number);
  init: () => Promise<void>;
  joinWorkforce: () => Promise<void | { err: unknown }>;
  leaveWorkforce: () => Promise<void | { err: unknown }>;
  getWorkers: () => Promise<{
    res?: DCST.Worker[];
    err?: unknown;
  }>;
  delegateJob: (
    workerID: string,
    filePaths: fs.PathLike[],
    opts?: {
      outDir?: fs.PathLike,
      whenJobAssigned?: (path: fs.PathLike) => void; // job assigned
      whenFilesSent?: () => void; // job files sent
      whenJobDone?: () => void; // job completed
    },
  ) => Promise<fs.PathLike | { err: unknown }>;
}
