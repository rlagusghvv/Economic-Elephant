// test_list_friends.js (ESM)
import "dotenv/config";
import { listFriends } from "./notify.js";

const r = await listFriends({ limit: 20 });
const friends = r?.elements || r?.friends || [];

console.log("친구 수:", friends.length);
for (const f of friends) {
  console.log("-", f.profile_nickname, "| uuid:", f.uuid);
}
