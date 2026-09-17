# Stage 2 — Design System / UI / Icon System

هذا المجلد مستقل تمامًا عن `Backend/` و`environments/` (Stage 1) ولا يعدّل
أي ملف منها. يمكن حذف هذا المجلد بالكامل في أي وقت دون أي تأثير على Stage 1.

## افتراض مهم يجب تأكيده منك (Assumption)

مجلد `Mobile/` في Stage 1 كان placeholder فارغًا فقط — **لم يتقرر بعد** ما
إذا كان تطبيق الموبايل سيُبنى بـ React Native, Flutter, أو Web/PWA. بما أن:

1. لا يوجد اتصال إنترنت في بيئة التنفيذ (لا يمكن `npm install react-native`
   أو `flutter pub get` أو أي تثبيت حزم خارجية الآن)، و
2. طلبت تنفيذ Login/Splash **فعليًا يعملان** وليس Mockup، لا توثيقًا نظريًا،

تم بناء Design System بتقنيات الويب القياسية (**HTML + CSS + Vanilla
JavaScript Web Components**) بدون أي حزمة خارجية وبدون أي خطوة تثبيت —
تعمل مباشرة بفتح ملف `.html` في أي متصفح، فورًا وبدون بناء (build step).

**لماذا هذا الاختيار تحديدًا وليس React Native/Flutter:**
- Design Tokens (الألوان، الخطوط، المسافات...) مُخزَّنة كـ JSON خام
  (`tokens/*.json`) — محايدة تمامًا لأي إطار عمل، ويمكن توليد ملفات مكافئة
  لـ React Native (`StyleSheet`) أو Flutter (`ThemeData`) منها لاحقًا بسكربت
  بسيط، دون إعادة تصميم أي قيمة.
- الـ Components مبنية كـ Web Components قياسية (`customElements.define`) —
  إذا تقرر لاحقًا استخدام React/Vue/Web فعليًا للموبايل (PWA)، هذا الكود
  **يُستخدم كما هو** فورًا، بدون تحويل.
- إذا تقرر لاحقًا React Native أو Flutter بدلًا من ذلك، الجزء الوحيد الذي
  يُعاد كتابته هو طبقة الـ Components (بنية الملفات والـ tokens تبقى كما
  هي كمرجع)، وهذا مُسجَّل صراحة في `STAGE2_TODO.md`.

هذا الاختيار **لا يفترض** أي قرار نهائي بخصوص إطار عمل الموبايل — هو فقط
الطريقة الوحيدة لتنفيذ "شاشات فعلية تعمل" داخل بيئة بلا إنترنت ولا تثبيت
حزم، طبقًا لتعليماتك.

## هيكلة المجلد
```
DesignSystem/
├── tokens/          # Design Tokens: JSON (مصدر الحقيقة) + tokens.css (المُستهلَك فعليًا)
├── icons/           # Icon System: سجل SVG واحد + <ds-icon> Web Component
├── components/       # Components قابلة لإعادة الاستخدام (Web Components)
├── theme/           # التحكم في Dark/Light و RTL/LTR
├── screens/
│   ├── splash/      # شاشة Splash فعلية تستخدم النظام
│   └── login/       # شاشة Login فعلية تستخدم النظام
├── DESIGN_SYSTEM.md # التوثيق الكامل
└── STAGE2_TODO.md   # أي بند مؤجَّل (خدمة خارجية أو قرار إطار عمل)
```

## تشغيل الشاشات الآن (بدون أي تثبيت)
افتح مباشرة في أي متصفح:
- `DesignSystem/screens/splash/index.html`
- `DesignSystem/screens/login/index.html`

كلاهما يحمّل التوكنز، الأيقونات، والمكونات من نفس المجلد بروابط نسبية —
بدون أي خادم أو build tool.
