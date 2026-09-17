# STAGE 17 — MUSIC/DJ — تقرير تقدّم (مو نهائي)

تاريخ الجلسة: 2026-09-16
الحالة: **قيد التنفيذ — التستات الرسمية ما زالت ما تشغلاتش بعد**

## 0. تأكيد نقطة البداية

تأكدت من `feature-platform.js`'s `STAGES` map: **Stage 17 = "Music/DJ"**،
وقبل هاد الجلسة كان فعلاً صفر كود بالكامل (لقيت غير الاسم فـ STAGES map
+ إشارة "music" فـ `room-catalog.js` وهي theme للغرفة، ماعلاقتها بالـDJ).

## 1. اللي كمّلته لحد الآن (كود حقيقي، مكتوب ومتأكد إنه يخدم بـ smoke test يدوي)

### ملفات جداد
- `Backend/src/database/models/music.model.js` — validators حقيقية:
  عنوان الأغنية (title، معدّي عبر word-filter)، الرابط (url، http/https
  إجباري)، المدة (durationSec، اختياري)، الصوت (volume 0-100).
- `Backend/src/realtime/music-bus.js` — نسخة بنيوية طبق الأصل من
  `chat-bus.js`/`notification-bus.js` (نفس بنية الـrealtime/ الموجودة
  أصلاً)، EventEmitter داخلي مقسّم بـ roomId، ماعندوش استهلاك (consumer)
  حالياً لأن ماكاين حتى WebSocket/SSE فالمشروع كامل — نفس وضعية
  chat-bus/notification-bus بالضبط.

### تعديلات على ملفات موجودة
- `Backend/src/feature-platform.js`:
  - زدت `musicBus` كـ optional constructor dependency فـ `createPlatform()`.
  - زدت domain كامل `music: {...}` (store type 17، مقسّم بـ `type`:
    'dj' | 'track' | 'player'، نفس نمط breakout/breakout-membership
    فـ roomInRoom):
    - **صلاحية DJ**: `grantDJ`/`revokeDJ`/`listDJs` — المالك (owner)
      وحدو يقدر يمنح/يسحب، والـDJ هو allowlist حقيقي محفوظ (مو مؤقت)،
      نفس السابقة اللي دارتها Room Ban (Stage 35) — لأن المشروع
      ماعندوش role تاني غير owner، فبدل ما نخترع role نظام جديد، دُرت
      allowlist مقيّد بالغرفة (room-scoped) يديره owner بس.
    - **Queue**: `queueAdd` (أي عضو فالغرفة)، `queueRemove` (DJ/owner
      أو صاحب الطلب نفسه، ونفس منطق `chat.service.js#deleteMessage`)،
      `queueReorder` (DJ فقط)، `queueList`.
    - **Play/Pause/Volume/Next حقيقية**: `play`/`pause`/`next`/
      `setVolume` (DJ فقط) — state transitions حقيقية (queued -> playing
      -> played)، auto-advance لأقرب أغنية فالطابور، player state واحد
      لكل غرفة.
    - **Realtime**: كل action حقيقي (grant/revoke، queue add/remove/
      reorder، play/pause/next/volume) كيـpublish لـ`musicBus` — نفس
      البنية المستعملة فالشات/الإشعارات بالضبط.
- `Backend/src/routes/platform.routes.js`: زدت كل الـroutes تحت
  `/api/rooms/:roomId/music/*` (dj، dj/revoke، queue، queue/:id/remove،
  queue/reorder، play، pause، next، volume، state) — نفس نمط باقي
  الـroutes (actorId ديما من `req.session.accountId`، ماكاين_route-level
  guard صريح، التحقق كيدير فـ service layer نفسو، نفس نمط seats/mute
  routes).
- `Backend/src/index.js`: زدت `createMusicBus()` ووصّلتها لـ
  `createPlatform()`.

### حاجة جربتها وتراجعت عليها (مهم نذكرها)
جربت نزيد notification حقيقي (`DJ_ASSIGNED`) لما owner يمنح DJ، لكن
هادشي كان غادي يتطلب زيادة type جديد فـ catalog ديال Stage 33
(`domain/notification-catalog.js`)، واللي عندها تيست مقفول
(`notification-catalog.test.js`) كيتأكد بالضبط من 19 types ديال Stage
33 — زيادة type جديد كانت غادي تكسر هاد التيست، يعني نلمس Stage 33 وهو
ممنوع. تراجعت على هاد الجزء بالكامل (حيّدت الـnotify call) باش Stage 17
يبقى معزول 100% وما يكسرش حتى تيست قديم. تأكدت بتشغيل
`notification-catalog.test.js` وحدو بعد التراجع: **8/8 pass**، بلا تغيير.

## 2. تأكيد يدوي (smoke test) — ماشي بديل عن `node --test` الرسمي

دُرت سكريبت يدوي (node -e) كيغطي: انشاء غرفة، انضمام عضو، منح DJ،
إضافة جوجين تراكات، play، setVolume، next (auto-advance للتراك التاني)،
getState، وحالتين خطأ (play على track مش موجود -> 404، غير-owner كيحاول
يمنح DJ -> 403). كل هاد الحالات عدّاو بالشكل المتوقع. هادشي بيقول أن
المنطق شغّال، **لكن ماشي بديل عن سويت تستات حقيقية بـ `node --test`**.

## 3. اللي باقي (ماكملتش بعد)

1. **التستات الرسمية**: باقي خاصني نكتب:
   - `Backend/test/music.stage17.test.js` (تستات service-level على
     `platform.music.*` — نفس ستايل `room-moderation.stage35.test.js`).
   - `Backend/test/platform.music.routes-contract.test.js` (تستات
     route-contract، نفس ستايل `platform.mute.routes-contract.test.js`،
     لأن `express` مش مثبّت فهاد الـsandbox).
2. **تشغيل تستات Stage 17 وحدها** ونعطي العدد الحقيقي (X/X).
3. **تشغيل السويت الكامل** (Backend + Mobile) نتأكد ما كسرتش شي حاجة
   قديمة (خصوصاً بغيت نعاود نشغّل السويت الكامل بعد ما زدت التستات
   الجداد، مش غير الملفات اللي بدّلتهم).
4. **التقرير النهائي** `STAGE17_FINAL_REPORT.md` بنفس أسلوب
   `STAGE35_FINAL_REPORT.md` (دليل كود + دليل تستات بإثبات حقيقي).
5. نرجّع الزيب النهائي المحدّث بعد كل هادشي.

## 4. الزيب المرفق مع هاد الرسالة

`STAGE17_WIP_PROJECT.zip` — يحتوي المشروع بالحالة الحالية (كل التعديلات
فـ §1 فوق داخلة)، لكن **بلا تستات جداد بعد** (نقطة 1-4 فـ §3 باقين).
الكود اتأكد إنه صحيح syntactically (`node --check` على الثلاث ملفات
المعدّلة + `require()` كامل لـ `feature-platform.js`) وخدم فالـsmoke
test اليدوي، لكن ماشي مُعتمد رسمياً حتى تكمل الخطوات فـ §3.
