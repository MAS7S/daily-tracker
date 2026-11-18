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

## تشغيل لوحة الإدارة

ادخل بالبريد الموثّق malekshahbien@gmail.com. يتوفر الفرع الرئيسي تلقائيًا. افتح **مشاركة وإدارة الفروع**. لإنشاء فرع مستقل أدخل الاسم وبريد المالك. لمشاركة فرع موجود حدده من قائمة الفروع ثم أدخل بريد العضو واضغط **حفظ وتفعيل**. كل عضو يملك حق تعديل دفتر الفرع المسند إليه. المدير وحده يضيف الحسابات وينقلها ويعطّلها. عند نقل المالك إلى فرع آخر تعود ملكية فرعه السابق إلى المدير.

استخدم الزر بجانب البريد للتبديل بين مفعّل ومعطّل. إنشاء حساب Firebase وحده لا يمنح صلاحية. عند استخدام البريد وكلمة المرور، اضغط إرسال رابط تأكيد البريد ثم تحقق من الوصول بعد التأكيد. يمكن للمدير اعتماد البريد قبل إنشاء الحساب.

يخزن التطبيق دفتر كل فرع في restaurants/{storeId}/ledgers/main وأجزائه تحت parts. بيانات الفرع الأساسية تشمل name وownerEmail. تحتوي access/{email} على storeId وactive. يقرأ الموظف تخصيصه، ويتحقق Firestore منه لكل عملية وصول للدفتر. المدير وحده يعدّل التخصيص. يمكن ربط عدة إيميلات بالفرع نفسه. زر تغيير اسم المتجر داخل الدفتر يغيّر عنوان التقرير فقط.

تُخزّن ملفات التطبيق للتثبيت والعمل دون اتصال. فتح بيانات الفروع يتطلب تأكيد الصلاحية عبر الإنترنت. عند فقد الاتصال تُقفل واجهة الدفتر، وتُستأنف التعديلات المعلقة عند عودة المستخدم بصلاحيته إلى الفرع نفسه. التغييرات المتزامنة المتعارضة تُعرض للاختيار مع نسخة احتياطية. لا يمكن سحب التقارير والنسخ التي سبق للمستخدم تصديرها.

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
