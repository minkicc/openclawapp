const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const aliases = {
  '@openclaw/message-sdk': path.resolve(__dirname, '../packages/message-sdk/dist/index.js'),
  '@openclaw/pair-sdk': path.resolve(__dirname, '../packages/pair-sdk/dist/index.js'),
};

const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const alias = aliases[moduleName];
  if (alias) {
    return {
      type: 'sourceFile',
      filePath: alias,
    };
  }

  if (typeof upstreamResolveRequest === 'function') {
    return upstreamResolveRequest(context, moduleName, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
