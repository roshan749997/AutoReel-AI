import test from 'node:test';
import assert from 'node:assert/strict';
import { findPairForFolder, findPairForPost, accountIdsOfPair } from '../../frontend/src/utils/channelPairs.js';

test('Channel match: subfolder videos belong to the parent folder pair', () => {
  const pairs = [
    { folderId: 'parent-tools', folderName: 'Tools reels', youtubeAccountId: 'yt1', instagramAccountId: 'ig1' },
    { folderId: 'part-1', folderName: 'Part 1', youtubeAccountId: 'yt2', instagramAccountId: 'ig2' },
  ];

  const parent = findPairForFolder(pairs, 'parent-tools', []);
  assert.equal(parent.folderName, 'Tools reels');

  const nested = findPairForFolder(pairs, 'other-child', ['parent-tools', 'other-child']);
  assert.equal(nested.folderName, 'Tools reels');

  const specific = findPairForFolder(pairs, 'part-1', ['parent-tools', 'part-1']);
  assert.equal(specific.folderName, 'Part 1');

  const post = {
    accountId: { _id: 'yt1' },
    videoId: { folderId: 'other-child', folderPathIds: ['parent-tools'] },
  };
  assert.equal(findPairForPost(pairs, post).folderName, 'Tools reels');
  assert.deepEqual(accountIdsOfPair(parent), ['yt1', 'ig1']);
});
