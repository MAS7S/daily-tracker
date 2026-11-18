# Daily Income & Expense Tracker

## إعداد مشروع Firebase المنفصل

1. أنشئ مشروعًا جديدًا في [Firebase Console](https://console.firebase.google.com/). أضف تطبيق Web من إعدادات المشروع وانسخ كائن firebaseConfig إلى المكان المعلّم في firebase-config.js. استخدم بيانات التطبيق الجديد. لا يتطلب ذلك إعداد Firebase Hosting.
2. من Authentication → Sign-in method فعّل Google واختر بريد الدعم، ثم فعّل Email/Password واحفظ الإعدادات. من Settings → Authorized domains أضف USERNAME.github.io فقط. أضف النطاق المخصص أيضًا إذا كنت ستستخدمه.
3. من Firestore Database أنشئ قاعدة (default) بالإصدار Standard وفي وضع Production واختر المنطقة. في تبويب Rules الصق محتوى firestore.rules ثم اضغط Publish. تشمل القواعد الدفتر وأجزاءه داخل الفرع المشترك..
4. بيانات Web config مخصّصة للواجهة العامة. لا ترفع مفتاح service account أو أي نسخة احتياطية فعلية إلى مستودع عام.

## النشر والتثبيت

1. أنشئ مستودع GitHub جديدًا مثل daily-tracker. ارفع محتويات مجلد daily-tracker إلى جذر الفرع main بعد ضبط Firebase. حافظ على مجلدي icons وvendor كما هما. لا يلزم تثبيت حزم أو تشغيل build.
2. اختر Settings → Pages → Build and deployment → Deploy from a branch → main → /(root) → Save.
3. افتح https://USERNAME.github.io/daily-tracker/ بعد نجاح النشر. أنشئ حسابًا وأدخل سجلًا تجريبيًا. بعد ظهور «تمت المزامنة» افتح الدفتر بالحساب نفسه في متصفح آخر.
4. للتثبيت على Android أو سطح المكتب استخدم أمر تثبيت التطبيق في Chrome أو Edge. على iPhone استخدم Safari → مشاركة → إضافة إلى الشاشة الرئيسية، وفعّل «فتح كتطبيق ويب» إن ظهر. على Mac يمكنك أيضًا استخدام «إضافة إلى Dock» في Safari المدعوم. اسم العرض تحت الأيقونة Daily Tracker.
5. عند نشر تحديث غيّر VERSION داخل sw.js. أغلق كل نوافذ الإصدار السابق ثم أعد فتح التطبيق.

## إدارة الفروع والموافقات

- مدير المشروع يفتح **Manage stores / إدارة الفروع**. لإنشاء فرع باسمه يستخدم **Create a store I own / إنشاء فرع باسمي**.
- لإتاحة إنشاء فرع لشخص، يكتب المدير بريده في **Approve one store / السماح بإنشاء فرع واحد** ويشاركه رابط الموقع. الموافقة تُسجّل داخل التطبيق. عند دخول الشخص بالبريد نفسه يظهر **Create my store / إنشاء فرعي**. بعد الإنشاء، يحتاج موافقة جديدة لكل فرع إضافي.
- لنقل فرع قائم، يختاره المدير، يكتب بريد المالك الجديد ويضغط **Transfer ownership / نقل ملكية الفرع**. يبقى دفتر الفرع وعمّاله على الفرع نفسه. ينتقل حق إدارته إلى البريد الجديد، ويحتفظ مدير المشروع بصلاحياته العامة.
- مالك الفرع يضيف العمّال بالبريد ويفعّلهم أو يعطّلهم من لوحة فرعه. حساب العامل يرتبط بفرع واحد، ويمكنه تعديل دفتره.
- بعد التحقق من البريد والصلاحيات، يكتب المستخدم اسمه في أول دخول. يظهر الاسم في أعلى التطبيق ويمكن تغييره من **Edit name / تعديل الاسم**.

## تحديث نسخة منشورة

1. من Firebase **Firestore Database → Rules**، انشر محتوى `firestore.rules` الجديد دوماً في مشروع التطبيق نفسه.
2. ارفع `index.html` و`cloud.js` و`sw.js` إلى جذر فرع GitHub المنشور. يتضمن هذا التحديث `README.md` عند الحاجة إلى تحديث دليل المستودع.
3. بعد انتهاء نشر GitHub Pages، أغلق نوافذ التطبيق القديمة وأعد فتح الرابط. قد يحتاج التطبيق المثبّت إلى الإغلاق وإعادة الفتح لتنشيط عامل الخدمة الجديد.

تتطلب صلاحيات الفروع اتصالاً بالشبكة. روابط الدخول تعمل بالبريد المسند إلى العامل أو المالك. يحدد الخادم صلاحيات الوصول وفق قواعد Firestore.

## نقل الدفتر السابق

قبل تغيير نشر قائم، افتح نسختك السابقة وصدّر نسخة JSON كاملة. بعد إعداد الصلاحيات حدّد الفرع الصحيح داخل الإصدار الجديد واستورد النسخة عبر استيراد النسخة الاحتياطية. يمنع هذا ربط دفتر شخصي تلقائيًا بفرع خاطئ. اختبر ببيانات تجريبية على حسابين مخوّلين للفرع نفسه ثم عطّل أحدهما وتحقق من قفل دفتره.

## إعادة تصدير الأيقونات

ملفات PNG جاهزة. لإعادة توليدها بعد تعديل icons/icon.svg نفّذ بواسطة Inkscape من داخل مجلد المشروع في Bash:

```bash
for size in 180 192 512 1024; do
  inkscape icons/icon.svg -w "$size" -h "$size" -o "icons/icon-$size.png"
done
```

## المراجع الرسمية

- [إضافة Firebase إلى تطبيق ويب](https://firebase.google.com/docs/web/setup)
- [Google Sign-In](https://firebase.google.com/docs/auth/web/google-signin) و[البريد وكلمة المرور](https://firebase.google.com/docs/auth/web/password-auth)
- [إعداد Firestore](https://firebase.google.com/docs/firestore/quickstart) و[قواعد الوصول](https://firebase.google.com/docs/firestore/security/get-started)
- [مصدر نشر GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [تثبيت تطبيقات الويب](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
