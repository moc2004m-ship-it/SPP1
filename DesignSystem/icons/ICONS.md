# Icon System

## مكتبة واحدة، مصدر واحد
كل الأيقونات مُعرَّفة مرة واحدة فقط في `icon-registry.js`. ممنوع نسخ SVG
لأي أيقونة في مكان تاني بالمشروع — أي مكون محتاج أيقونة يستخدم
`<ds-icon name="...">`.

## النمط الموحد (لازم ينطبق على أي أيقونة تُضاف مستقبلاً)
- `viewBox="0 0 24 24"` ثابت لكل الأيقونات.
- `stroke="currentColor"` و`fill="none"` — اللون يورث من الـ CSS `color`،
  مفيش لون مكتوب جوه الـ SVG نفسه (عشان يشتغل صح في Dark Mode تلقائيًا).
- `stroke-width="1.8"`, `stroke-linecap="round"`, `stroke-linejoin="round"`.
- الاسم بصيغة kebab-case، ومعبّر عن المفهوم البصري (`eye`, `eye-off`,
  `chevron`, مش `icon1`, `icon2`).

## الأيقونات الموجودة حاليًا
| الاسم | الاستخدام |
|---|---|
| `logo` | شعار التطبيق — شاشة Splash |
| `mail` | أيقونة حقل البريد الإلكتروني |
| `lock` | أيقونة حقل كلمة المرور |
| `eye` | إظهار كلمة المرور |
| `eye-off` | إخفاء كلمة المرور |
| `chevron` | زر الرجوع في App Bar (يتقلب تلقائيًا حسب الاتجاه) |
| `check` | علامة الاختيار داخل Checkbox عند التحديد |
| `close` | زر إغلاق الـ Dialog/Sheet |

## طريقة الاستخدام
```html
<script type="module" src="/DesignSystem/icons/ds-icon.js"></script>

<ds-icon name="mail" size="20"></ds-icon>
```
- الحجم بالبكسل عبر `size` (افتراضي 20).
- اللون بيتغير تلقائيًا مع `color` بتاع العنصر الأب — مفيش حاجة إضافية
  للتعامل مع Dark Mode.

## إضافة أيقونة جديدة
1. ارسم SVG بنفس المواصفات فوق (24x24, stroke, currentColor).
2. ضيفها كخاصية جديدة في `ICONS` بملف `icon-registry.js` باسم kebab-case.
3. لا تنشئ ملف SVG منفصل ولا تكررها في أي مكون — استخدم `<ds-icon>` دايمًا.
