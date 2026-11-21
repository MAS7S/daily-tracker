# Daily Income & Expense Tracker

## الاستضافة والنشر

رابط التطبيق هو [Daily Tracker](https://daily-income-tracking.web.app/). يستخدم التطبيق مشروع Firebase الحالي `daily-income-tracking` وقاعدة Firestore نفسها.

كل تحديث للفرع `main` يشغّل `.github/workflows/firebase-hosting-merge.yml`. يجهّز `prepare-hosting.cjs` ملفات الواجهة في `.hosting-build` وتنشرها مهمة GitHub Actions باستخدام السر `FIREBASE_SERVICE_ACCOUNT`. تنشر مهمة القواعد الحالية تحديثات `firestore.rules` بصورة مستقلة.

للمعاينة محليًا، شغّل `node prepare-hosting.cjs` ثم `npx firebase-tools emulators:start --only hosting`. تستخدم هذه المعاينة إعدادات المصادقة وقاعدة البيانات المحددة في `firebase-config.js`.

عند الانتقال من GitHub Pages، سجّل الدخول على النطاق الجديد بالحساب نفسه لفتح دفاترك المحفوظة. إذا كانت لديك تغييرات محلية على النطاق القديم، افتحه من الجهاز والمتصفح نفسيهما واترك الدفتر يتزامن أو صدّر نسخة احتياطية قبل الانتقال. يمكن تثبيت التطبيق من رابط Firebase الجديد.

## إدارة الفروع والموافقات

- مدير المشروع يفتح **Manage stores / إدارة الفروع**. لإنشاء فرع باسمه يستخدم **Create a store I own / إنشاء فرع باسمي**.
- لإتاحة إنشاء فرع لشخص، يكتب المدير بريده في **Approve one store / السماح بإنشاء فرع واحد** ويشاركه رابط الموقع. الموافقة تُسجّل داخل التطبيق. عند دخول الشخص بالبريد نفسه يظهر **Create my store / إنشاء فرعي**. بعد الإنشاء، يحتاج موافقة جديدة لكل فرع إضافي.
- لنقل فرع قائم، يختاره المدير، يكتب بريد المالك الجديد ويضغط **Transfer ownership / نقل ملكية الفرع**. يبقى دفتر الفرع وعمّاله على الفرع نفسه. ينتقل حق إدارته إلى البريد الجديد، ويحتفظ مدير المشروع بصلاحياته العامة.
- مالك الفرع يضيف العمّال بالبريد ويفعّلهم أو يعطّلهم من لوحة فرعه. حساب العامل يرتبط بفرع واحد، ويمكنه تعديل دفتره.
- بعد التحقق من البريد والصلاحيات، يكتب المستخدم اسمه في أول دخول. يظهر الاسم في أعلى التطبيق ويمكن تغييره من **Edit name / تعديل الاسم**.

يتابع التطبيق صلاحية الحساب عبر `ownerInvites/{email}` بعد التأكد من البريد ومعرّف المستخدم. يؤدي إلغاء الوصول إلى حذف الموافقة، وتمنع قواعد Firestore الوصول إلى الدفتر. يحتفظ التطبيق بنسخة من التعديلات المحلية غير المتزامنة قبل تسجيل الخروج عند وصول إشعار الإلغاء.

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
