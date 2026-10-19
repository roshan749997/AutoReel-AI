import { connectDatabase, closeDatabase } from '../src/config/database.js';
import { Account } from '../src/models/Account.js';

async function run() {
  await connectDatabase();
  const res = await Account.updateMany(
    { accountId: { $regex: /^(UC_expired_|yt_|UC_chan_|UC_brand_|UC_healthy_|UC_failing_|UC_dup_|UC_target_)/ } },
    { $set: { isDemo: true } }
  );
  console.log('Updated mock accounts to isDemo: true:', res.modifiedCount);

  const all = await Account.find({});
  console.log('Current accounts count:', all.length);
  all.forEach((a) => {
    console.log(` - ${a.accountName} (${a.accountId}) [isDemo: ${a.isDemo}]`);
  });

  await closeDatabase();
}

run().catch(console.error);
