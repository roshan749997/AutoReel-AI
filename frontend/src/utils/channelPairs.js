export function accountIdsOfPair(pair) {
  return [pair?.youtubeAccountId, pair?.instagramAccountId].filter(Boolean).map(String);
}

export function findPairForFolder(pairs, folderId, folderPathIds = []) {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  const byId = new Map(pairs.map((pair) => [String(pair.folderId), pair]));
  if (folderId && byId.has(String(folderId))) {
    return byId.get(String(folderId));
  }
  const trail = [...(folderPathIds || [])].map(String).filter(Boolean);
  if (folderId) {
    const self = trail.lastIndexOf(String(folderId));
    if (self >= 0) trail.splice(self, 1);
  }
  for (let i = trail.length - 1; i >= 0; i -= 1) {
    if (byId.has(trail[i])) return byId.get(trail[i]);
  }
  return null;
}

export function findPairForPost(pairs, post) {
  const video = post?.videoId && typeof post.videoId === 'object' ? post.videoId : null;
  const fromFolder = findPairForFolder(pairs, video?.folderId, video?.folderPathIds);
  if (fromFolder) return fromFolder;
  const accountId = String(post?.accountId?._id || post?.accountId || '');
  if (!accountId) return null;
  return pairs.find((pair) => accountIdsOfPair(pair).includes(accountId)) || null;
}

export function channelTitle(pair, accounts = []) {
  if (pair?.folderName) return pair.folderName;
  const yt = accounts.find((account) => String(account._id) === String(pair?.youtubeAccountId));
  const ig = accounts.find((account) => String(account._id) === String(pair?.instagramAccountId));
  return yt?.accountName || ig?.accountName || ig?.username || 'Unnamed channel';
}

export function channelAccountLabels(pair, accounts = []) {
  const yt = accounts.find((account) => String(account._id) === String(pair?.youtubeAccountId));
  const ig = accounts.find((account) => String(account._id) === String(pair?.instagramAccountId));
  return {
    youtube: yt?.accountName || 'YouTube not set',
    instagram: ig?.username ? `@${ig.username}` : ig?.accountName || 'Instagram not set',
  };
}
