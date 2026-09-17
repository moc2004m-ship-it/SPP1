# STAGE11_FINAL_REPORT.md — Private Chat

## 0. الحالة النهائية

**Stage 11 = DONE.** لا تست وهمي، لا كود ميت متبقٍ، صفر Regression مؤكَّد
بثلاث تشغيلات كاملة للسويت.

هذا التقرير يوثّق فقط ما أُنجز **في هذه الجلسة (الاستئناف)**: حذف الكود
الميت المتبقي + كل التستات الجديدة. كل ما هو موصوف كـ"من الجلسة السابقة" في
`STAGE11_PROGRESS_STOPPED.md` (تحديث 2) — الـrepository، الـschema،
الـbus، الـservice، والـwiring الثلاثة — **لم يُلمس مرة أخرى**، فقط قُرئ
واستُخدم كما هو.

## 1. ما أُنجز هذه الجلسة

### 1.1 حذف الكود الميت
`Backend/src/feature-platform.js` — حُذفت الدالة القديمة:
```js
chat: {
  send(input) { return store.add(11,{...}); }
}
```
(كانت حوالي السطر 288-290). تأكيد قبل الحذف وبعده عبر
`grep -rn "platform.chat\b"` و`grep -rn "\.chat\.send\b"` على المشروع
كاملاً (Backend + Mobile): **صفر نتائج** في الحالتين — الدالة لم تكن
مستهلكة من أي مكان. `node --check` ناجح على الملف بعد الحذف. لم تُلمس أي
دالة أخرى في نفس الملف (`social`/`profile`/`search` وغيرها — بلا تغيير).

تشغيل السويت الكامل فورًا بعد هذا الحذف وحده:
```
node --test test/*.test.js
# tests 669
# pass 665
# fail 4   (نفس الأربعة البيئية الدائمة: Cannot find module 'express' —
#           accounts.routes/agora.routes/auth.routes/config.routes)
```
مطابق تمامًا للأساس الموثّق في `STAGE11_PROGRESS_STOPPED.md` — صفر
Regression من الحذف.

### 1.2 تستات حقيقية جديدة (100 تست، كلها ناجحة)

ملاحظة: `STAGE11_PROGRESS_STOPPED.md` (تحديث 2) كان يفترض أن
`chat.model.test.js`/`chat-catalog.test.js` "موجودان من قبل" — فحص فعلي
لمجلد `test/` في بداية هذه الجلسة أظهر أن **لا وجود لأي ملف تست بهذا
الاسم إطلاقًا** (كان هذا افتراضًا خاطئًا في ذلك التقرير، غالبًا خلطًا مع
ملفات دومينات أخرى). لذلك أُنشئت كل ملفات تست Stage 11 الخمسة من الصفر
هذه الجلسة، بنفس نمط `guard.service.test.js`/
`platform.notifications.routes-contract.test.js`:

| الملف | عدد التستات | يغطي |
|---|---|---|
| `test/chat-catalog.test.js` | 5 | `resolveSticker` (نجاح/400 لـid مجهول أو فارغ)، تجميد `STICKERS` وكل عنصر فيه |
| `test/chat.model.test.js` | 22 | توليد id (فريد، بادئة صحيحة)، `assertValidMessageType`، تحقق الحمولة لكل الأنواع الأربعة (text/emoji/sticker/image) نجاحًا وفشلاً — حدود الطول، رفض URL غير http(s)، رفض stickerId مجهول |
| `test/chat.repository.test.js` | 25 | idempotency إنشاء المحادثة (بغض النظر عن ترتيب الاستدعاء)، ترتيب `listConversationsForAccount` تنازليًا، إضافة/جلب/ترتيب زمني للرسائل (مع limit)، `markConversationRead` (تجاهل رسائل القارئ نفسه، idempotent)، `softDeleteMessage` (تصفير الحقول + إبقاء الصف + idempotent)، `reportMessage`، `countUnreadForConversation`، presence كاملة (heartbeat → online، اشتقاق offline بعد تجاوز النافذة بلا mutation، `goOffline` يحفظ lastSeenAt الحقيقي بلا إحياء، عزل بين حسابات) |
| `test/chat.service.test.js` | 39 | رفض self-chat، الحظر في الاتجاهين (عند الإنشاء + إعادة فحص عند كل إرسال بعد فتح المحادثة)، `whoCanMessage` (everyone ينجح افتراضيًا / nobody يُرفض / friends ينجح فقط بصداقة accepted حقيقية ويُرفض إن كانت pending)، كل أنواع الرسائل الأربعة، `reply` صحيح وخاطئ (محادثة مختلفة/id غير موجود)، `delivered` الحقيقي مقابل `sent` (presence حقيقي عبر heartbeat، بما فيها تجاوز نافذة الأونلاين)، نشر على bus + استدعاء notify مع الشكل الدقيق، سلوك سليم بلا bus/notificationService، عزل `listConversations`/الرسائل بين أزواج مختلفة، حذف بواسطة غير المرسل (403) وبواسطة المرسل (نجاح)، بلاغ عن رسالتك الخاصة (403) وعن رسالة غيرك (نجاح)، `getPresence` يُخفي lastSeenAt لغير المالك عند showLastSeen:false لكن يُبقيه ظاهرًا للمالك نفسه ولغيره عندما showLastSeen:true |
| `test/platform.chat.routes-contract.test.js` | 14 | ترتيب تسجيل المسارات في نص الملف الفعلي (`/api/chat/stickers`+`/api/chat/conversations` قبل `/api/chat/conversations/:id/...`؛ `/api/presence/heartbeat`+`/offline` قبل `/api/presence/:userId`)، شكل الاستدعاء الدقيق لكل مسار (actingAccountId دائمًا من session، conversationId/messageId/userId من params، otherUserId/type/body/... من body)، بما فيها محاولة تهريب هوية مختلفة عبر body مرفوضة بنفس منطق الخدمة |

نفس منهج `platform.notifications.routes-contract.test.js`: `platform.routes.js`
لا يمكن استيراده في هذه البيئة (`require('express')` في أول الملف، و`express`
غير مثبَّت — نفس القيد البيئي الدائم الموثّق لأربعة ملفات تست أخرى مسبقًا)،
فالتحقق من عقد المسارات يتم بقراءة نص الملف فعليًا (لترتيب التسجيل) وبمحاكاة
الشكل الدقيق لاستدعاء `chatService` كما يفعله كل handler، دون إعادة إثبات
منطق التفويض (المُثبت بالكامل في `chat.service.test.js`).

## 2. تأكيد نهائي — صفر Regression (3 تشغيلات كاملة متتالية)

```
node --test test/*.test.js   (×3 تشغيلات متتالية)
# tests 769   (669 أساس + 100 جديد: 5+22+25+39+14=100)
# pass 765    (665 أساس + 100 جديد)
# fail 4      (نفس الأربعة البيئية الدائمة، بلا تغيير)
```
الأربعة الفاشلة هي حصرًا: `accounts.routes.test.js`، `agora.routes.test.js`،
`auth.routes.test.js`، `config.routes.test.js` — جميعها `Cannot find module
'express'`، قيد بيئي معروف منذ جلسات سابقة، غير متعلق بـStage 11 إطلاقًا.

`node --check` ناجح على كل ملف مُعدَّل أو جديد هذه الجلسة:
`feature-platform.js`، `chat.repository.js`، `chat.service.js`،
`chat.model.js`، `chat-catalog.js`، `chat-bus.js`، `database/index.js`،
`src/index.js`، `platform.routes.js`، وكل ملفات التست الخمسة الجديدة.

## 3. ملخص Stage 11 الكامل (عبر الجلستين معًا)

- **الكتالوج/الموديل** (`chat-catalog.js`، `chat.model.js`): كانا من
  جلسة سابقة، لم يُلمسا هذه الجلسة — فقط اختُبرا الآن لأول مرة.
- **Repository** (`chat.repository.js` — InMemory + Postgres، ثلاثة
  كيانات: conversations/messages/presence): من الجلسة السابقة، لم يُلمس.
- **Schema** (`023_create_private_chat.sql`): من الجلسة السابقة، لم يُلمس.
- **Bus** (`chat-bus.js`): من الجلسة السابقة، لم يُلمس.
- **Service** (`chat.service.js` — كل قواعد التفويض/الخصوصية): من الجلسة
  السابقة، لم يُلمس.
- **Wiring** (`database/index.js`، `src/index.js`، `platform.routes.js`):
  من الجلسة السابقة، لم يُلمس.
- **الكود الميت** (`feature-platform.js`'s `chat.send`): **حُذف هذه
  الجلسة.**
- **التستات** (100 تست عبر 5 ملفات): **كُتبت هذه الجلسة بالكامل.**
- **صفر Regression**: مؤكَّد في كلتا الجلستين (669/665/4 ثم 769/765/4).

## 4. لم يُلمس ولن يُلمس بلا طلب صريح منفصل

- `moderation.report()`/Stage 35، `notification-catalog.js` (النوع
  `PRIVATE_MESSAGE` كان جاهزًا مسبقًا، لم يُعدَّل)، وأي ملف من
  Stage 10/13/14/16/26/33 سوى القراءة منها (لا كتابة).
- Mobile UI لمحادثة خاصة — **لم يبدأ**.
- Realtime حقيقي (WebSocket/SSE فعلي) — يبقى BLOCKED بيئيًا صراحة؛
  `chat-bus.js` هو أقصى ما تسمح به هذه البيئة (لا شبكة).
- Postgres الحقيقي — `PostgresChatRepository` مراجَع بصريًا فقط، لم
  يُشغَّل ضد قاعدة بيانات حقيقية (لا شبكة في هذه البيئة — نفس القيد
  الموثّق لكل Postgres* class في المشروع).

## 5. الخطوة التالية (خارج نطاق هذه الجلسة)

Stage 11 مُغلق بالكامل. الخطوة التالية الطبيعية في خطة الـ40 مرحلة هي
الانتقال لأول مرحلة غير مُنجزة بعد Stage 11 — بانتظار طلب صريح لتحديد
أيّها.
