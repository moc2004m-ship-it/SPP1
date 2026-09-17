# Design System — التوثيق الكامل

هذا الملف هو المرجع الوحيد لكل ما بُني في Stage 2. أي شاشة جديدة لاحقًا
(Stage 3 وما بعدها) يجب أن تُبنى فقط من العناصر الموثّقة هنا — بدون ألوان
أو مسافات أو أيقونات جديدة تُكتب يدويًا خارج هذا النظام.

## 0. طريقة التشغيل الآن (بدون تثبيت)

افتح مباشرة في المتصفح:
- `DesignSystem/screens/splash/index.html`
- `DesignSystem/screens/login/index.html`

لا يوجد build step ولا حزم خارجية. كل ملف JS هو ES Module قياسي يعمل
بـ `<script type="module">`، وكل Component هو Web Component قياسي
(`customElements.define`).

---

## 1. Design Tokens

المصدر الوحيد للحقيقة هو ملفات JSON في `tokens/*.json` (محايدة تمامًا لأي
إطار عمل مستقبلي — ويب، React Native، Flutter). النسخة المُستهلَكة فعليًا
في الشاشات الحالية هي `tokens/tokens.css` (CSS Custom Properties)، ويجب أن
تبقى متطابقة يدويًا مع الـ JSON (توليد تلقائي مؤجَّل، انظر `STAGE2_TODO.md`).

### Colors (`tokens/colors.json` + `tokens.css`)
| Token | Light | Dark | الاستخدام |
|---|---|---|---|
| `--color-background` | `#FFFFFF` | `#0F1115` | خلفية الشاشة |
| `--color-surface` | `#F5F6F8` | `#191C22` | خلفية البطاقات/الحقول |
| `--color-surface-alt` | `#ECEDF1` | `#22262E` | حالة Pressed للأسطح |
| `--color-border` | `#DADDE3` | `#2E323C` | حدود الحقول والبطاقات |
| `--color-text-primary` | `#14161A` | `#F2F3F5` | النص الأساسي |
| `--color-text-secondary` | `#5A5F6B` | `#A7ACB8` | النص الثانوي |
| `--color-text-on-primary` | `#FFFFFF` | `#0F1115` | نص فوق لون Primary |
| `--color-primary` | `#2F6FED` | `#5B8DEF` | الأزرار الأساسية والتركيز |
| `--color-primary-pressed` | `#2557BE` | `#7CA3F2` | حالة Pressed للأزرار |
| `--color-primary-disabled` | `#A9C3F5` | `#33425E` | مرجعي لحالات Disabled الملونة |
| `--color-danger` | `#E5484D` | `#FF6B70` | الأخطاء |
| `--color-success` | `#2FAE60` | `#4CC988` | النجاح |
| `--color-focus-ring` | `#94B8FA` | `#5B8DEF` | حلقة التركيز عند التنقل بالكيبورد |

**قاعدة صارمة:** أي Component جديد يستخدم `var(--color-*)` فقط. ممنوع كتابة
قيمة hex مباشرة داخل أي ملف مكون.

### Typography (`tokens/typography.json`)
- `--font-family-base`: خطوط نظام التشغيل فقط (بدون تحميل خطوط خارجية)،
  مع fallback لـ `Noto Sans/Kufi Arabic`.
- الأحجام: `xs=12 sm=14 md=16 lg=18 xl=22 xxl=28` (px).
- الأوزان: `regular=400 medium=500 semibold=600 bold=700`.
- ارتفاع السطر: `tight=1.2 normal=1.5 relaxed=1.7`.

### Spacing (`tokens/spacing.json`)
مقياس أساسه 4px: `1=4 2=8 3=12 4=16 5=20 6=24 8=32 10=40 12=48` (px).
كل مسافة (padding/gap/margin) في أي Component يجب أن تكون إحدى هذه القيم.

### Radius (`tokens/radius.json`)
`sm=4 md=8 lg=12 xl=20 full=999` (px).

### Shadows (`tokens/shadows.json`)
`sm/md/lg` لكل من الوضعين الفاتح والداكن (الداكن بشفافية أعلى لأنه فوق خلفية
داكنة أصلاً).

### Motion
`--motion-fast=120ms`, `--motion-normal=200ms`, `--motion-easing` — تُستخدم
في كل انتقال بصري لحالات Pressed/Loading/Dialog.

---

## 2. Icon System (`icons/`)

- **مصدر واحد فقط:** `icons/icon-registry.js` (كائن `ICONS`).
- **نمط ثابت لكل أيقونة:** `viewBox="0 0 24 24"`, `stroke="currentColor"`,
  `fill="none"`, `stroke-width="1.8"`, `stroke-linecap/linejoin="round"`.
- **الاستخدام دائمًا عبر:** `<ds-icon name="..." size="20"></ds-icon>`
  (custom element في `icons/ds-icon.js`) — ممنوع نسخ أي SVG في مكان آخر.
- **الأيقونات الحالية:** `logo, mail, lock, eye, eye-off, chevron, check, close`
  (التفاصيل والاستخدام المقترح لكل واحدة في `icons/ICONS.md`).
- إضافة أيقونة جديدة = إضافة مفتاح جديد في `ICONS` فقط، بنفس المواصفات.

---

## 3. Theme: Dark Mode + RTL/LTR (`theme/theme.js`)

نقطة تحكم واحدة لكل من الاتجاه والوضع الليلي:

```js
import { initTheme, setTheme, toggleTheme, setDirection, toggleDirection } from "./theme/theme.js";

initTheme();        // يُستدعى مرة عند تحميل أي شاشة — يقرأ dir/data-theme من <html> إن وُجدا
toggleTheme();      // Light <-> Dark
toggleDirection();  // LTR <-> RTL
```

- **Dark Mode:** يعمل عبر `[data-theme="dark"]` على `<html>`، ويقلب كل قيم
  الألوان/الظلال في `tokens.css` تلقائيًا. أي Component يستخدم `var(--color-*)`
  يعمل صح في الوضعين بدون أي كود إضافي.
- **RTL/LTR:** يعمل عبر `[dir]` على `<html>`. كل الـ Components مبنية بخصائص
  CSS منطقية (`margin-inline-*`, `padding-inline`, `text-align: start`, `inset-inline-*`)
  فتنقلب الواجهة كاملة تلقائيًا بدون قواعد CSS مكرّرة. الاستثناء الوحيد هو
  سهم الرجوع (`ds-app-bar`)، الذي يستمع لحدث `ds-direction-change` ليقلب
  اتجاهه بصريًا (لأن أيقونة السهم نفسها اتجاهية وليست نصًا).
- يبث كل تغيير حدثين على `window`: `ds-theme-change` و`ds-direction-change`
  — أي Component أو شاشة تحتاج تتفاعل مع التغيير تستمع لهما (كما يفعل
  `ds-app-bar`).
- لا تخزين في `localStorage/sessionStorage` عن قصد (الحالة في الذاكرة فقط
  خلال حياة الصفحة) — ربطها بتفضيلات مستخدم حقيقية مؤجَّل لمرحلة لاحقة.

---

## 4. Components (`components/`)

كل Component مبني بـ Shadow DOM (تغليف كامل)، ويستهلك التوكنز عبر
CSS Custom Properties التي تتوارث تلقائيًا عبر حدود الـ Shadow DOM — فلا
حاجة لتكرار أي قيمة تصميم داخل أي Component.

### `<ds-button>` (`button.js`)
```html
<ds-button variant="primary" icon="mail" icon-position="start">إرسال</ds-button>
<ds-button variant="secondary" size="sm">ثانوي</ds-button>
<ds-button variant="danger">حذف</ds-button>
<ds-button variant="ghost">رابط بسيط</ds-button>
<ds-button full-width>بعرض كامل</ds-button>
```
**الحالات الحقيقية:** `default`, `hover`, `:active` (Pressed)، `focus-visible`،
`[selected]` (لأزرار التبديل)، `[loading]` (سبينر يحل محل النص، والزر يتوقف
عن الاستجابة للنقر)، `[disabled]` (يعطّل النقر فعليًا عبر `button.disabled`
الأصلي في DOM الداخلي، وليس مجرد شكل بصري).

### `<ds-text-field>` (`text-field.js`)
```html
<ds-text-field label="البريد الإلكتروني" type="email" icon="mail" required></ds-text-field>
<ds-text-field label="كلمة المرور" type="password" icon="lock"></ds-text-field>
```
**الحالات الحقيقية:** `default`, `:focus-within`, `has-value` (Filled)،
`[error]` مع `error-text` يظهر فعليًا تحت الحقل، `[disabled]`. حقول
`type="password"` تحصل تلقائيًا على زر إظهار/إخفاء حقيقي (`eye`/`eye-off`)
يبدّل نوع الـ `<input>` فعليًا بين `password` و`text`. الخاصية `.value`
والأحداث `input`/`change` تعمل بنفس عقد الـ `<input>` الأصلي.

### `<ds-checkbox>` (`checkbox.js`)
```html
<ds-checkbox label="تذكرني" checked></ds-checkbox>
```
**الحالات الحقيقية:** `default`, `hover`, `:active` (Pressed)، `focus-visible`،
`[checked]` (= **Selected**، الحالة المطلوبة صراحة في المتطلبات)، `[disabled]`.
قابل للتفعيل بالماوس وبالكيبورد (Space/Enter) ويبث `change` بـ
`event.detail.checked`.

### `<ds-card>` (`card.js`)
```html
<ds-card padding="lg" elevation="md">...محتوى...</ds-card>
```
حاوية بصرية بدون حالات تفاعلية خاصة بها — التفاعل يخص العناصر بداخلها.

### `<ds-app-bar>` (`app-bar.js`)
```html
<ds-app-bar title="تسجيل الدخول" back></ds-app-bar>
```
يبث حدث `ds-back` عند الضغط على زر الرجوع (الشاشة الأم تقرر معنى "رجوع").
سهم الرجوع يتقلب تلقائيًا مع تغيّر `dir`.

### `<ds-dialog>` (`dialog.js`)
```html
<ds-dialog open title="عنوان" variant="dialog | sheet">...محتوى...</ds-dialog>
```
**الحالات الحقيقية:** `[open]` / مغلق. الإغلاق (زر X، الضغط على الخلفية،
أو Escape) لا يحذف العنصر — يبث `ds-close` والشاشة الأم هي من تُزيل
`[open]`، بنفس فلسفة `<dialog>` الأصلي في HTML. `variant="sheet"` يعرضه
كـ Bottom Sheet بدل نافذة مركزية.

### `<ds-spinner>` / `<ds-loading-overlay>` (`loading.js`)
```html
<ds-spinner size="24"></ds-spinner>
<ds-loading-overlay label="جارٍ التحميل..."></ds-loading-overlay>
```
مؤشرا تحميل قابلان لإعادة الاستخدام في أي شاشة (تُستخدم داخل `ds-button`
أيضًا لحالة `[loading]` الخاصة بها).

### استيراد مُجمَّع
```html
<script type="module" src="../../components/index.js"></script>
```
يستورد كل الـ Components دفعة واحدة، أو استورد كل ملف على حدة حسب الحاجة.

---

## 5. Assets (`icons/` + بنية جاهزة للتوسّع)

لا توجد صور Raster أو خطوط خارجية في هذه المرحلة (الأيقونات SVG داخل
`icon-registry.js` فقط، والخطوط من نظام التشغيل — انظر `notes` في
`tokens/typography.json`). عند إضافة صور/خطوط حقيقية لاحقًا، تُنشأ:
- `DesignSystem/assets/images/` للصور/الـ placeholders.
- `DesignSystem/assets/fonts/` لملفات الخطوط، مع تسجيلها في `tokens.css`.
كل أصل يُضاف مرة واحدة فقط ويُستهلك بالإحالة، بنفس منطق الأيقونات — بدون
تكرار نفس الملف في أكثر من مكان.

---

## 6. الشاشتان التجريبيتان (`screens/`)

### Splash (`screens/splash/index.html`)
شعار (`ds-icon name="logo"`) داخل حاوية بلون Primary + `ds-loading-overlay`
+ زرّي تبديل Dark/Light و RTL/LTR للتجربة الحية. بعد فترة قصيرة (محاكاة
تحميل) ينتقل تلقائيًا لشاشة Login.

### Login (`screens/login/index.html`)
`ds-app-bar` (مع رجوع لـ Splash) + `ds-card` تحتوي حقلي `ds-text-field`
(بريد/كلمة مرور مع إظهار كلمة المرور الحقيقي) + `ds-checkbox` "تذكرني" +
`ds-button` بحالة `loading` فعلية عند الضغط (تحقق بسيط من صحة الإدخال أولًا،
ويعرض رسائل `[error]` حقيقية على الحقول عند الفشل) + `ds-button variant="ghost"`
يفتح `ds-dialog` (بنمط Sheet) لاستعادة كلمة المرور. هذا يثبت أن كل من:
الأزرار، الحقول، الأيقونات، الحوار، البطاقة، شريط العنوان، والتوكنز —
تعمل معًا فعليًا، وليست مجرد Mockup.

**كل منطق تسجيل الدخول/الشبكة/الحفظ في هذه الشاشات هو محاكاة عرض توضيحي
فقط (لا يوجد Backend حقيقي متصل)** — هذا متوقع ومقصود في Stage 2، والربط
الفعلي مسجَّل في `STAGE2_TODO.md`.

---

## 7. استخدام النظام في شاشات قادمة (Stage 3+)

1. لأي شاشة جديدة: أضف `<link rel="stylesheet" href=".../tokens/tokens.css">`
   و`<link rel="stylesheet" href=".../components/base.css">`، واستورد
   `components/index.js` (أو الملفات التي تحتاجها فقط).
2. ابنِ الشاشة من `<ds-*>` الموجودة فقط. لو المطلوب غير موجود، أضف Component
   جديد هنا أولًا (بنفس نمط Shadow DOM + توكنز)، ولا تكتب CSS/HTML خام
   مكرّرًا داخل الشاشة نفسها.
3. أي قيمة تصميم جديدة (لون، مسافة، حجم) تُضاف كـ Token جديد في `tokens/`
   أولًا، ثم تُستخدم — لا تُكتب كقيمة حرفية أبدًا.
4. عند اعتماد إطار عمل الموبايل النهائي (React Native/Flutter/PWA)، ملفات
   `tokens/*.json` تُستهلك كما هي لتوليد الطبقة المكافئة؛ التفاصيل في
   `STAGE2_TODO.md`.
