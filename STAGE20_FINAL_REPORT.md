# Stage 20 (Ludo + Carrom) — STATUS: FINAL ✅

## واش كمل (الكل، مشغّل ومتحقق منه فعليًا)

### الكود (Backend) — من الجلسة السابقة، بلا تعديل
- `Backend/src/domain/ludo.board.js` — قواعد حركة Ludo نقية (pure).
- `Backend/src/services/ludo.service.js` — المحرك الحقيقي: نرد
  server-side، حركة على مرحلتين (roll ثم move) مع إعادة تحقق حقيقية
  للشرعية فكل move (بلا ثقة بـ`legalPieceIndices` القدام)، capturing
  حقيقي، قاعدة 3 سيتّة متتالية، auto-skip للدور إذا مفماش حركة شرعية،
  فوز حقيقي عبر `gameMatchService.finishMatch()`.
- `Backend/src/services/carrom.service.js` — المحرك الحقيقي: كل ضربة
  نتيجتها server-side عبر `node:crypto` على bands ثابتة، تسجيل نقاط
  حقيقي (+10/+50/-5)، queen cover/revert حقيقي، shot clock حقيقي
  (timeout أوتوماتيكي)، فوز/تعادل حقيقي.
- `Backend/src/domain/carrom-board.js` — bands + نقاط نقية.
- `Backend/src/routes/platform.routes.js`, `Backend/src/index.js` —
  ربط الروتات + الخدمتين، ludo/carrom دخلو لـ`ENGINE_BACKED_GAMES`.

### التستات — جديدة بالكامل هاذ الجلسة
- **`Backend/test/ludo.board.test.js`** — 8/8 ✅ (من قبل، بلا تغيير).
- **`Backend/test/ludo.service.test.js`** — **جديد، 12/12 ✅**. تغطي:
  صلاحيات (participant/turn)، منع move قبل roll و roll مرتين، auto-skip
  إذا مفماش حركة شرعية، رفض pieceIndex غير شرعي، قاعدة "سيتّة = دور
  إضافي"، قاعدة 3 سيتّة متتالية = forfeit، **capturing حقيقي** (سيناريو
  مسكرت كامل: قطعة عدو ترجع للقاعدة، متحقق منه ضد `absoluteSquare`/
  `isSafeSquare` مباشرة + عبر تنفيذ حقيقي)، **فوز حقيقي كامل** (الـ4
  قطع توصل للبيت بسيناريو مسكرت بالكامل، متحقق بتنفيذ فعلي قبل الكتابة)،
  رفض roll/move بعد نهاية اللعبة، reconnect (getState يرجع نفس الحالة).
- **`Backend/test/carrom-board.test.js`** — **جديد، 5/5 ✅**. تغطي:
  الثوابت، الـbands الأربعة كاملة (foul/miss/pocket/queen) بلا فجوة ولا
  تداخل، حدود كل band، رفض roll خارج [1,100] أو غير صحيح.
- **`Backend/test/carrom.service.test.js`** — **جديد، 16/16 ✅**. تغطي:
  صلاحيات، pocket حقيقي (+10 + دور إضافي)، miss (دور يفوت)، foul
  (-5 بلا نزول تحت 0)، **queen cover حقيقي** (+50 بونص لما تتغطى فورًا)،
  **queen revert حقيقي** (لما ما تتغطاش، ترجع تلعب)، fallback الـqueen
  band لما تكون الملكة خلاصت (تولي pocket، بلا ضياع الرول ولا اختراع
  نتيجة)، **timeout حقيقي** (شوت كلوك يخلص، الدور يضيع أوتوماتيك ويتسجل
  فالتاريخ)، timeout وقت queen cover pending (ترجع تلعب كيما miss)، رفض
  strike بعد النهاية، **فوز حقيقي كامل** (اللوح يخلص، أعلى نقاط يربح)،
  **تعادل حقيقي** (نقاط متساوية = draw:true، بلا winnerId)، reconnect.

كل تست فهاذ الملفات الثلاثة الجداد بُني بسيناريو مسكرت (`scriptedRoll` /
`fakeClock`) **متحقق منه بالتنفيذ الفعلي قبل الكتابة النهائية** — ماشي
حساب يدوي بلا تجربة. لقيت وصلحت جوج بق حقيقيين فالتستات نفسها أثناء
التحقق (تفاصيل تحت).

## بقات صغيرة اتصلحو أثناء الكتابة (فالتستات، ماشي فالكود)
- تست الـfoul: `scoreDelta` عطى `-0` (سالب صفر، سلوك JS طبيعي من
  `-penalty` وين `penalty=0`) — التست كان يقارن بـ`0` بالضبط فطاح؛
  صلحتها بمقارنة `Math.abs(...)`. الكود نفسه ماشي فيه بق، غير المقارنة
  فالتست.
- تست الـtimeout: كنت نـ`advance` الساعة الوهمية قبل ما نقرا الحالة
  مرة وحدة (اللي يبدّي `turnStartedAt`) — صلحتها بقراءة `getState`
  مرة قبل الـadvance.

## التحقق العام (السويت الكامل)
```
node --test test/*.test.js
```
**1614/1614 تست، 1610 ينجحو، 4 يفشلو** — نفس الـ4 القدام بالضبط
(`Cannot find module 'express'` بسبب عدم توفر نت/`node_modules` فهاذ
الـsandbox، **بلا أي regression جديد**؛ متحقق منه واحد واحد إنهم نفس
الملفات اللي كانت تفشل من قبل).

قبل هاذ الجلسة: 1581 تست (1577 ينجحو). زدنا **33 تست جديد** (12+5+16)،
الكل ينجح.

## واش مزال
**والو.** Stage 20 (Ludo + Carrom) كاملة 100%: الكود، التستات، السويت
الكامل، وهاذ التقرير.

## المطابقة لمعيار الإكمال
- **كل حركة تتحقق سيرفريًا:** النرد، الحركة، الـcapturing، النتيجة،
  التسجيل، الفوز — الكل server-side فـ`ludo.service.js` و
  `carrom.service.js`، الكود ماشي تبدّل، ومتحقق منه بالتستات الجداد.
- **تستات لحالات الغش المحتملة:** move قبل roll، roll مرتين، pieceIndex
  غير شرعي، move لقطعة بلا حركة شرعية، actor مو صاحب الدور، strike بعد
  النهاية — كلها مغطاة برفض حقيقي (400/409).
- **سجل تاريخ حقيقي:** `history` فكل match، متحقق منه بمحتواه (مثلاً
  `captured` فحركة Ludo، `coveredQueen`/`outcome` فضربة Carrom).

## الزيب
مرفق فهاذ الرد: المشروع كامل، بالكود بلا تغيير من قبل + التستات
الثلاثة الجداد (ludo.service.test.js, carrom-board.test.js,
carrom.service.test.js) + هاذ التقرير.
