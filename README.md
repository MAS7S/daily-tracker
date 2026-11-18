# Daily Income & Expense Tracker

## إعداد مشروع Firebase المنفصل

1. أنشئ مشروعًا جديدًا في [Firebase Console](https://console.firebase.google.com/). أضف تطبيق Web من إعدادات المشروع وانسخ كائن firebaseConfig إلى المكان المعلّم في firebase-config.js. استخدم بيانات التطبيق الجديد. لا يتطلب ذلك إعداد Firebase Hosting.
2. من Authentication → Sign-in method فعّل Google واختر بريد الدعم، ثم فعّل Email/Password واحفظ الإعدادات. من Settings → Authorized domains أضف USERNAME.github.io فقط. أضف النطاق المخصص أيضًا إذا كنت ستستخدمه.
3. من Firestore Database أنشئ قاعدة (default) بالإصدار Standard وفي وضع Production واختر المنطقة. في تبويب Rules الصق محتوى firestore.rules ثم اضغط Publish. تشمل القواعد الدفتر وأجزاءه تحت معرف المستخدم.
4. بيانات Web config مخصّصة للواجهة العامة. لا ترفع مفتاح service account أو أي نسخة احتياطية فعلية إلى مستودع عام.

## النشر والتثبيت

1. أنشئ مستودع GitHub جديدًا مثل daily-tracker. ارفع محتويات مجلد daily-tracker إلى جذر الفرع main بعد ضبط Firebase. حافظ على مجلدي icons وvendor كما هما. لا يلزم تثبيت حزم أو تشغيل build.
2. اختر Settings → Pages → Build and deployment → Deploy from a branch → main → /(root) → Save.
3. افتح https://USERNAME.github.io/daily-tracker/ بعد نجاح النشر. أنشئ حسابًا وأدخل سجلًا تجريبيًا. بعد ظهور «تمت المزامنة» افتح الدفتر بالحساب نفسه في متصفح آخر.
4. للتثبيت على Android أو سطح المكتب استخدم أمر تثبيت التطبيق في Chrome أو Edge. على iPhone استخدم Safari → مشاركة → إضافة إلى الشاشة الرئيسية، وفعّل «فتح كتطبيق ويب» إن ظهر. على Mac يمكنك أيضًا استخدام «إضافة إلى Dock» في Safari المدعوم. اسم العرض تحت الأيقونة Daily Tracker.
5. بعد أول فتح متصل وتسجيل الدخول، جرّب إعادة فتح التطبيق دون اتصال وتعديل مبلغ. يعيد التطبيق المحاولة عند عودة الإنترنت. يحتاج تسجيل دخول جديد إلى اتصال. عند نشر تحديث، غيّر VERSION داخل sw.js وارفع التغييرات معًا. تُستخدم النسخة الجديدة بعد إغلاق جميع نوافذ النسخة السابقة وفتح التطبيق من جديد.

## بياناتك القديمة

في المتصفح وعلى نفس النطاق تُنسخ بيانات daily-tracker-v2 الموجودة إلى أول حساب يدخل على الجهاز. تأكد من استخدام حساب صاحب الدفتر أولًا. يحتفظ التطبيق بالنسخة المحلية الأصلية. إذا كان الملف القديم مفتوحًا بصيغة file:// أو كان على نطاق آخر، صدّر نسخة JSON كاملة من الملف القديم ثم استعدها من شاشة النسخ الاحتياطي داخل التطبيق الجديد بعد الدخول. استخدم JSON لنقل الشيكات والفئات والأرشيف معًا.

النسخة المحلية مرتبطة بالحساب والمتصفح وتبقى محفوظة بعد الخروج لتستأنف المزامنة لاحقًا. استخدم جهازًا موثوقًا، وانتظر «تمت المزامنة» قبل مسح بيانات المتصفح. إذا تغيّر الدفتر على جهازين قبل المزامنة يعرض التطبيق اختيارًا بين نسختين، ويسمح بتنزيل النسخة الأخرى. لا يدمج المبالغ المتعارضة تلقائيًا. إذا حظر المتصفح التنزيل فاستعمل زر تنزيل نسخة الجهاز قبل اختيار نسخة السحابة.

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
