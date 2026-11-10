/**
 * Node 24 的 `node --test <dir>` 不再直接展开目录，
 * 这里通过 server/tests/package.json 的 main 指向本文件，
 * 让 `npm test`（node --test server/tests）仍然能跑完所有测试。
 */
import './util-domains.test.mjs';
import './tags.test.mjs';
import './store-settings.test.mjs';
import './checkins.test.mjs';
import './auto-checkin.test.mjs';
import './books-papers.test.mjs';
import './weread.test.mjs';
import './recommendations.test.mjs';
import './recommendation-quality.test.mjs';
import './publication.test.mjs';
import './api.test.mjs';
