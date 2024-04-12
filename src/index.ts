import fs from 'node:fs';
// import type { PathLike } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { io } from 'socket.io-client';
import { spawn } from 'child_process';
import { Socket } from 'socket.io-client';
import type * as DCST from 'delcom-server';
import type * as DCCT from './types.d.ts';

const outputNames = [
  'build_std_out',
  'build_std_err',
  'run_std_out',
  'run_std_err',
];

export class Client {
  private _config: DCCT.Config;
  private _socket?: Socket;

  constructor( ip: string, port: number) {
    this._config = {
      ip,
      port,
      id: '',
      isWorking: false,
      isDelegating: false,
      isWorker: false,
      workerInfo: {
        machineArch: os.arch(),
        cpus: os.cpus().map((cpu) => {
          return { model: cpu.model, speed: cpu.speed};
        }),
        ram: os.totalmem(),
      },
    };
  }

  /**
   * Call to initialize the connection to the IP and port
   *
   * @returns A void promise on successful connection
   */
  async init(): Promise<void> {
    // set up temp parent folder
    this._config.delcomTempDir = path.join(os.tmpdir(), 'DELCOM');
    if (!fs.existsSync(this._config.delcomTempDir)) {
      console.warn(`${this._config.delcomTempDir} not detected, making...`);
      await fsp.mkdir(this._config.delcomTempDir);
    }

    const addr = `http://${this._config.ip}:${this._config.port}`;
    const socket = io(addr); // todo add query with config
    this._socket = socket;

    socket.on(
      'new_job_ack',
      async (fileNames: string[], callback: DCCT.CallbackWithErr) => {
        try {
          console.log('Job requested, preparing...');
          if (this._config.isWorking || this._config.job) {
            throw Error('Already working job!');
          }
          this._config.isWorking = true;
          if (!this._config.delcomTempDir) {
            throw Error('No temp dir!');
          }
          this._config.job = {
            dir: await fsp.mkdtemp(
              `${this._config.delcomTempDir}${path.sep}job`,
            ),
            writeStreams: {},
          };
          console.log(
            `New job files will be stored at ${this._config.job.dir}`,
          );
          for (const fileName of fileNames) {
            this._config.job.writeStreams[fileName] = fs.createWriteStream(
              `${this._config.job.dir}${path.sep}${fileName}`,
              { encoding: 'base64' },
            );
          }
          callback();
        } catch (err) {
          this.clearJob(err, callback);
        }
      },
    );

    socket.on(
      'receive_file_data_ack',
      (
        arg0: DCCT.ReceiveFileDataArg,
        callback: DCCT.CallbackWithErr,
      ) => {
        try {
          if (!this._config.job) {
            throw Error('No job setup to write to!');
          }
          const { name, chunk } = arg0;
          const jobWS = this._config.job.writeStreams;
          jobWS[name].write(chunk, (err) => {
            if (err) {
              this.clearJob(err, callback);
            } else {
              callback();
            }
          });
        } catch (err) {
          this.clearJob(err, callback);
        }
      },
    );

    for (const outputName of outputNames) {
      socket.on(`${outputName}`, async (
        chunk: string | Buffer,
        callback: DCCT.CallbackWithErr,
      ) => {
        try {
          const ws = this._config.res?.writeStreams[outputName];
          if (!ws) {
            throw Error('No writeable stream to write to!');
          }
          ws.write(chunk);
        } catch (err) {
          this.clearJob(err, callback);
        }
      });
    }

    socket.on('run_job_ack', async (
      callback: DCCT.CallbackWithErr,
    ) => {
      try {
        // TODO ensure write streams are drained, clear them
        await this.buildContainer();
        console.log('built job, running');
        await this.runContainer();
        console.log('finished job');
        callback();
        socket.emit('done');
        this.clearJob();
      } catch (err) {
        this.clearJob(err, callback);
      }
    });

    socket.on('finished', () => {
      this.clearDelegation();
    });

    socket.on('get_config_ack', (
      callback: DCCT.GetConfigAckCB,
    ) => {
      callback(this._config);
    });

    socket.on('disconnect', (reason) => {
      console.log(`Disconnected: ${reason}`);
    });

    socket.on('delegator_disconnect', () => {
      console.log('Delegator has disconnected. Stopping job.');
      this.clearJob('Delegator has disconnected');
    });

    socket.on('worker_disconnect', () => {
      console.log('Worker has disconnected. Stopping job.');
      this.clearDelegation('Worker has disconnected');
    });

    return new Promise<void>((res) =>
      socket.on('connect', async () => {
        console.log('connected');
        this._config.id = await socket.emitWithAck(
          'identify',
          this._config.workerInfo,
        );
        res();
      }),
    );
  }

  /**
   *
   * @returns A void promise on success
   */
  async joinWorkforce(): Promise<void | { err: unknown }> {
    try {
      this._config.isWorker = true;
      if (!this._socket) {
        throw Error('Not connected, cannot become worker!');
      }
      await this._socket.emitWithAck(
        'join_ack',
      );
    } catch (err) {
      return { err };
    }
  }

  async leaveWorkforce(): Promise<void | { err: unknown }> {
    try {
      this._config.isWorker = false;
      if (!this._socket) {
        throw Error('Not connected, cannot stop working!');
      }
      await this._socket.emitWithAck('leave_ack');
    } catch (err) {
      return { err };
    }
  }

  /**
   *
   * @returns
   */
  async getWorkers(): Promise<{
    res?: DCST.Worker[];
    err?: unknown;
  }> {
    try {
      const socket = this._socket;
      if (!socket) {
        throw Error('Cannot get workers, no socket!');
      }
      const res: DCST.Worker[] = await socket.emitWithAck('get_workers_ack');
      return { res };
    } catch (err) {
      return { err };
    }
  }

  /**
   *
   * @param workerID the workerID to delegate the job to
   * @param filePaths dockerfile and dockerfile build deps
   * @param outDir optional directory to save to
   * @param cbs optional callback functions
   * @returns // TODO result directory
   */
  async delegateJob(
    workerID: string,
    filePaths: fs.PathLike[],
    opts?: {
      outDir?: fs.PathLike,
      whenJobAssigned?: (path: fs.PathLike) => void; // job assigned
      whenFilesSent?: () => void; // job files sent
      whenJobDone?: () => void; // job completed successfully
    },
  ): Promise<fs.PathLike | { err: unknown }> {
    try {
      console.log('Creating job');
      await this.createJob(workerID, filePaths, opts?.outDir);
      console.log('Job Created');
      const outDir = this._config.res?.dir;
      if (!outDir) {
        throw Error('No outDir after creating job?');
      }
      if (opts?.whenJobAssigned) opts.whenJobAssigned(outDir);
      await this.sendFiles(filePaths);
      if (opts?.whenFilesSent) opts.whenFilesSent();
      await this._config.res?.finishPromise.promise;
      if (opts?.whenJobDone) opts?.whenJobDone();
      return outDir;
    } catch (err) {
      return { err };
    }
  }

  private buildContainer() {
    return new Promise<void>((res, rej) => {
      if (!this._config.job?.dir) {
        return rej('No job dir to build from!');
      }
      if (!this._socket) {
        return rej('No socket to build with!');
      }
      const dir = this._config.job?.dir.toString();
      const socket = this._socket;
      const dockerName = path.basename(dir).toLowerCase();
      const build = spawn('docker', [
        'build',
        `-t${dockerName}`,
        '--progress=plain',
        dir,
      ]);
      build.stdout.on('data', (chunk) => {
        socket.emit('build_std_out', chunk);
      });
      build.stderr.on('data', (chunk) => {
        socket.emit('build_std_err', chunk);
      });
      build.on('close', (code) => {
        if (code) {
          return rej(`Build failed with code ${code}`);
        } else {
          return res();
        }
      });
    });
  }

  private runContainer() {
    return new Promise<void>((res, rej) => {
      if (!this._config.job?.dir) {
        return rej('No job dir to build from!');
      }
      if (!this._socket) {
        return rej('No socket to build with!');
      }
      const dir = this._config.job?.dir.toString();
      const socket = this._socket;
      const dockerName = path.basename(dir).toLowerCase();
      const build = spawn('docker', ['run', dockerName]);
      build.stdout.on('data', (chunk) => {
        socket.emit('run_std_out', chunk);
      });
      build.stderr.on('data', (chunk) => {
        socket.emit('run_std_err', chunk);
      });
      build.on('close', (code) => {
        if (code) {
          return rej(`Runtime failed with code ${code}`);
        } else {
          return res();
        }
      });
    });
  }

  private async createJob(
    workerID: string,
    filePaths: fs.PathLike[],
    outDir?: fs.PathLike,
  ) {
    try {
      this._config.isDelegating = true;
      this._config.res = {
        dir:
          outDir ? outDir : (
            await fsp.mkdtemp(`${this._config.delcomTempDir}${path.sep}res`)
          ),
        writeStreams: {},
        finishPromise: {},
      };
      this._config.res.finishPromise.promise = new Promise<void>((res, rej) => {
        if (this._config.res) {
          this._config.res.finishPromise.res = res;
          this._config.res.finishPromise.rej = rej;
        }
      });
      for (const outputName of outputNames) {
        this._config.res.writeStreams[outputName] = fs.createWriteStream(
          `${this._config.res.dir}${path.sep}${outputName}`,
        );
      }
      if (!(await fsp.lstat(this._config.res.dir)).isDirectory()) {
        throw Error(`outDir is not a valid directory! Was given ${outDir}`);
      }
      const fileNames = await Promise.all(
        filePaths.map(async (filePath) => {
          if (!(await fsp.lstat(filePath)).isFile()) {
            throw Error(`Invalid file path! ${filePath} is not a file!`);
          }
          return path.basename(filePath.toString());
        }),
      );
      if (!fileNames.includes('Dockerfile')) {
        throw Error('No Dockerfile found in filePaths!');
      }
      console.log(`Starting new job, storing at ${this._config.res.dir}`);
      const ack = await this._socket?.emitWithAck(
        'new_job_ack',
        {
          workerID,
          fileNames,
        },
      );
      if (ack) {
        throw ack;
      }
    } catch (err) {
      this.clearDelegation(err);
    }
  }

  private async sendFiles(filePaths: fs.PathLike[]) {
    try {
      const socket = this._socket;
      if (!socket) {
        throw Error('No socket to send through!');
      }
      await Promise.all(
        filePaths.map(async (filePath) => {
          const name = path.basename(filePath.toString());
          const readStream = fs.createReadStream(filePath, {
            encoding: 'base64',
          });
          readStream.on('data', async (chunk) => {
            await socket.emitWithAck('send_file_data_ack', { name, chunk });
          });
          return new Promise<void>((resolve, reject) => {
            readStream.on('close', () => {
              if (readStream.errored) {
                reject(`readStream for ${name} errored`);
              }
              resolve();
            });
          });
        }),
      );
      console.log('files done sending');
      socket.emit('files_done_sending');
    } catch (err) {
      this.clearDelegation(err);
    }
  }

  private clearJob(err?: unknown, callback?: DCCT.CallbackWithErr) {
    this._config.isWorking = false;
    this._config.job = undefined;
    if (err) {
      console.log(err);
    }
    // console.log('clearJob 4');
    if (callback) {
      if (err instanceof Error) {
        callback({ err: err.message });
      } else if (typeof err == 'string') {
        callback({ err });
      } else if (err) {
        callback({ err: 'Unknown error' });
      } else {
        callback();
      }
    }
  }

  private clearDelegation(err?: unknown) {
    if (err) {
      console.error(err);
      if (this._config.res?.finishPromise.rej) {
        // this._config.res.finishPromise.rej('reject');
      }
    } else {
      if (this._config.res?.finishPromise.res) {
        this._config.res.finishPromise.res();
      }
    }
    this._config.isDelegating = false;
    this._config.res = undefined;
  }
}
