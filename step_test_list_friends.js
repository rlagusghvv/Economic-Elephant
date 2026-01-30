// step_test_list_friends.js
import "dotenv/config";
import { listFriends } from "./notify.js";

(async () => {
  const res = await listFriends(); // kakao/send.js의 구현을 탐
  console.log(JSON.stringify(res, null, 2));
})();
