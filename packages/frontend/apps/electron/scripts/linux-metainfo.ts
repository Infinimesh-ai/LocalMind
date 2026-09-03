export function renderLinuxMetainfo(
  source: string,
  appId: string,
  protocolScheme: string
) {
  return source
    .replaceAll('ai.infinimesh.localmind', appId)
    .replaceAll(
      'x-scheme-handler/localmind',
      `x-scheme-handler/${protocolScheme}`
    );
}
