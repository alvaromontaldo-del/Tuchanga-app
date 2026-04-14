const { NgrokClient, NgrokClientError } = require("./src/client");
const uuid = require("uuid");
const {
  getProcess,
  getActiveProcess,
  killProcess,
  resetProcessCache,
  setAuthtoken,
  getVersion,
} = require("./src/process");
const { defaults, validate, isRetriable } = require("./src/utils");

let processUrl = null;
let ngrokClient = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errText(err) {
  return [
    err && err.message,
    err && err.code,
    err && err.body && err.body.msg,
    err && err.body && err.body.details && err.body.details.err,
  ]
    .filter(Boolean)
    .join(" ");
}

function needsAgentRespawn(err) {
  const t = errText(err);
  return (
    err.code === "ECONNREFUSED" ||
    /ECONNREFUSED|127\.0\.0\.1:4040|:4040\b/i.test(t)
  );
}

async function connect(opts) {
  opts = defaults(opts);
  validate(opts);
  if (opts.authtoken) {
    await setAuthtoken(opts);
  }

  processUrl = await getProcess(opts);
  ngrokClient = new NgrokClient(processUrl);
  await delay(900);
  return connectRetry(opts, 0, 0);
}

async function connectRetry(opts, retryCount = 0, respawnCount = 0) {
  if (!ngrokClient || !processUrl) {
    processUrl = await getProcess(opts);
    ngrokClient = new NgrokClient(processUrl);
    await delay(900);
  }

  opts.name = String(opts.name || uuid.v4());
  try {
    const response = await ngrokClient.startTunnel(opts);
    return response.public_url;
  } catch (err) {
    if (!isRetriable(err) || retryCount >= 150) {
      throw err;
    }

    if (needsAgentRespawn(err) && respawnCount < 20) {
      await killProcess();
      resetProcessCache();
      ngrokClient = null;
      processUrl = null;
      await delay(800);
      processUrl = await getProcess(opts);
      ngrokClient = new NgrokClient(processUrl);
      await delay(1200);
      return connectRetry(opts, retryCount + 1, respawnCount + 1);
    }

    await delay(350);
    return connectRetry(opts, retryCount + 1, respawnCount);
  }
}

async function disconnect(publicUrl) {
  if (!ngrokClient) return;
  const tunnels = (await ngrokClient.listTunnels()).tunnels;
  if (!publicUrl) {
    const disconnectAll = tunnels.map((tunnel) =>
      disconnect(tunnel.public_url)
    );
    return Promise.all(disconnectAll);
  }
  const tunnelDetails = tunnels.find(
    (tunnel) => tunnel.public_url === publicUrl
  );
  if (!tunnelDetails) {
    throw new Error(`there is no tunnel with url: ${publicUrl}`);
  }
  return ngrokClient.stopTunnel(tunnelDetails.name);
}

async function kill() {
  await killProcess();
  resetProcessCache();
  ngrokClient = null;
  processUrl = null;
}

function getUrl() {
  return processUrl;
}

function getApi() {
  return ngrokClient;
}

module.exports = {
  connect,
  disconnect,
  authtoken: setAuthtoken,
  kill,
  getUrl,
  getApi,
  getVersion,
  getActiveProcess,
  NgrokClientError,
};
