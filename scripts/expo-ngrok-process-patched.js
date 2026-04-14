const { promisify } = require("util");
const { spawn, exec: execCallback } = require("child_process");
const exec = promisify(execCallback);

const bundledBin = require("@expo/ngrok-bin");
const fromEnv = process.env.EXPO_NGROK_BIN && process.env.EXPO_NGROK_BIN.trim();
const bin =
  fromEnv && fromEnv.length > 0
    ? fromEnv.replace(/^["']|["']$/g, "")
    : bundledBin;
if (!bin) {
  throw new Error(
    "No hay binario ngrok: npm install @expo/ngrok o definí EXPO_NGROK_BIN en .env",
  );
}

const ready = /starting web service.*addr=(\d+\.\d+\.\d+\.\d+:\d+)/;
const inUse = /address already in use/;

let processPromise, activeProcess;

async function getProcess(opts) {
  if (processPromise) return processPromise;
  try {
    processPromise = startProcess(opts);
    return await processPromise;
  } catch (ex) {
    processPromise = null;
    throw ex;
  }
}

function getActiveProcess() {
  return activeProcess;
}

function parseAddr(message) {
  if (message[0] === "{") {
    const parsed = JSON.parse(message);
    return parsed.addr;
  } else {
    const parsed = message.match(ready);
    if (parsed) {
      return parsed[1];
    }
  }
}

async function startProcess(opts) {
  const start = ["start", "--none", "--log=stdout"];
  if (opts.region) start.push("--region=" + opts.region);
  if (opts.configPath) start.push("--config=" + opts.configPath);

  const ngrok = spawn(bin, start, { windowsHide: true });

  let resolve, reject;
  const apiUrl = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  ngrok.stdout.on("data", (data) => {
    const msg = data.toString().trim();
    if (opts.onLogEvent) {
      opts.onLogEvent(msg);
    }
    if (opts.onStatusChange) {
      if (msg.match("client session established")) {
        opts.onStatusChange("connected");
      } else if (msg.match("session closed, starting reconnect loop")) {
        opts.onStatusChange("closed");
      }
    }

    const msgs = msg.split(/\n/);
    msgs.forEach((msg) => {
      const addr = parseAddr(msg);
      if (addr) {
        let hostPort = addr;
        if (hostPort.startsWith("[::1]:")) hostPort = "127.0.0.1:" + hostPort.slice(6);
        else if (hostPort.startsWith("::1:")) hostPort = "127.0.0.1:" + hostPort.slice(4);
        resolve(`http://${hostPort}`);
      } else if (msg.match(inUse)) {
        reject(new Error(msg.substring(0, 10000)));
      }
    });
  });

  ngrok.stderr.on("data", (data) => {
    const msg = data.toString().substring(0, 10000);
    reject(new Error(msg));
  });

  ngrok.on("exit", () => {
    processPromise = null;
    activeProcess = null;
  });

  ngrok.on("error", (err) => {
    reject(err);
  });

  try {
    const url = await apiUrl;
    activeProcess = ngrok;
    return url;
  } catch (ex) {
    ngrok.kill();
    throw ex;
  } finally {
    if (!opts.onLogEvent && !opts.onStatusChange) {
      ngrok.stdout.removeAllListeners("data");
    }
    ngrok.stderr.removeAllListeners("data");
  }
}

function resetProcessCache() {
  processPromise = null;
}

function killProcess() {
  return new Promise((resolve) => {
    if (!activeProcess) {
      processPromise = null;
      resolve();
      return;
    }
    const proc = activeProcess;
    proc.once("exit", () => {
      processPromise = null;
      activeProcess = null;
      resolve();
    });
    try {
      proc.kill();
    } catch {
      processPromise = null;
      activeProcess = null;
      resolve();
    }
  });
}

process.on("exit", () => {
  if (activeProcess) {
    activeProcess.kill();
  }
});

async function setAuthtoken(optsOrToken) {
  const isOpts = typeof optsOrToken !== "string";
  const opts = isOpts ? optsOrToken : {};
  const token = isOpts ? opts.authtoken : optsOrToken;

  const authtoken = ["authtoken", token];
  if (opts.configPath) authtoken.push("--config=" + opts.configPath);

  const ngrok = spawn(bin, authtoken, { windowsHide: true });

  const killed = new Promise((resolve, reject) => {
    ngrok.stdout.once("data", () => resolve());
    ngrok.stderr.once("data", () => reject(new Error("cant set authtoken")));
    ngrok.on("error", (err) => reject(err));
  });

  try {
    return await killed;
  } finally {
    ngrok.kill();
  }
}

async function getVersion(opts = {}) {
  const { stdout } = await exec(`${bin} --version`);
  return stdout.replace("ngrok version", "").trim();
}

module.exports = {
  getProcess,
  getActiveProcess,
  killProcess,
  resetProcessCache,
  setAuthtoken,
  getVersion,
};
