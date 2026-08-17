export type GuiUpdateChannel = 'latest' | 'alpha';

export interface GuiUpdateChannelPolicy {
  channel: GuiUpdateChannel;
  allowPrerelease: boolean;
  repository: {
    owner: string;
    repo: string;
  };
}

/** Resolve the GUI update source from the persisted preview preference. */
export function resolveGuiUpdateChannelPolicy(
  allowTestUpdates: boolean,
): GuiUpdateChannelPolicy {
  if (allowTestUpdates) {
    return {
      channel: 'alpha',
      allowPrerelease: true,
      repository: {
        owner: 'ShiinaKuroko',
        repo: 'AutoWSGR-GUI',
      },
    };
  }
  return {
    channel: 'latest',
    allowPrerelease: false,
    repository: {
      owner: 'yltx',
      repo: 'AutoWSGR-GUI',
    },
  };
}
