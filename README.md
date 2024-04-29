# DELCOM-Client
Object for DELCOM client

Import into your project with `npm i DELegatedCOMpute/DELCOM-Client` and import `delcom-client`. See DELCOM-CLI for usage examples.

`delcomClient.init()`: join the server

`delcomClient.joinWorkforce()`: makes this client available to do jobs

`delcomClient.leaveWorkforce()`: makes this client unavailable to do jobs. Client will continue to finish job if working one.

`delcomClient.getWorkers()`: returns the available workers

`delcomClient.delegateJob(workerID, filePaths, {outDir, whenJobAssigned, whenFilesSent, whenJobDone)`

-  workerID: the workerID to request for the job (from `getWorkers()`)
-  filePaths: An array of fs.PathLike paths to files
-  outDir: the directory for the output. If blank, a temp dir will be made
-  whenJobAssigned: A callback for when the job is assigned
-  whenFilesSent: "" files sent
-  whenJobDone: "" job is done
