import fs from 'node:fs';
import { Socket } from 'socket.io-client';

export type workerListElement = {
  id: string;
};

export type callbackWithErr = (arg0?: { err: string }) => void;

// client listener types
export type jobInfoType = {
  dir: fs.PathLike;
  writeStreams: { [key: string]: fs.WriteStream };
};

export type resultInfoType = {
  dir: fs.PathLike;
  writeStreams: { [key: string]: fs.WriteStream };
  finishPromise: {
    promise?: Promise<void>;
    res?: () => void;
    rej?: (arg0?: unknown) => void;
  };
};

export type configType = {
  ip: string; // ip of server
  port: number; // port of server
  socket?: Socket; // socket to server
  id?: string; // unique ID
  delcomTempDir?: string;
  isWorking: boolean; // if the client is currently working
  isDelegating: boolean; // if the client is currently working
  isWorker: boolean; // if the client is willing to work
  job?: jobInfoType; // info about current job
  res?: resultInfoType; // info about job results
};

// Client Listener Functions

export type newJobAckArg = { fileNames: string[] };
export type newJobAckCB = callbackWithErr;

export type receiveFileDataArg = { name: string; chunk: string | Buffer };
export type receiveFileDataCB = callbackWithErr;

export type outputArg = { chunk: string | Buffer };
export type outputCB = callbackWithErr;

export type runJobAckArg = void;
export type runJobAckCB = callbackWithErr;

export type finishedArg = void;

export type getConfigAckArg = void;
export type getConfigAckCB = (arg0: configType) => void;

export interface DelcomClient {
  init: () => Promise<void>;
  joinWorkforce: () => Promise<void | { err: unknown }>;
  leaveWorkforce: () => Promise<void | { err: unknown }>;
  getWorkers: () => Promise<{
    res?: dcc.workerListElement[];
    err?: unknown;
  }>;
  delegateJob: (
    workerID: string,
    filePaths: fs.PathLike[],
    opts?: {
      outDir?: fs.PathLike,
      cbs?: {
        whenJobAssigned?: (path: fs.PathLike) => void; // job assigned
        whenFilesSent?: () => void; // job files sent
        whenJobDone?: () => void; // job completed
      },
    },
  ) => Promise<PathLike | { err: unknown }>;
}
