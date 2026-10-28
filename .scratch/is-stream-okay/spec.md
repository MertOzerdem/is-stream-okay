# Is Stream Okay — İlk sürüm şartnamesi

Status: complete

## Problem Statement

İzleyici bir canlı yayında ses veya oynatma sorunu yaşadığında yayının bağımsız bir ortamda nasıl çalıştığını hızlıca göremez.

## Solution

Üyeliksiz bir dış test sitesi Twitch veya Kick yayın linkini alır, yayını izleyicinin cihazından ayrı bir ortamda yaklaşık 30 saniye test eder ve sonuçları tek sayfada ilgili kutucuklarda sunar. Sonuçlar yalnızca testin gözlemlediği koşulları ve süreyi açıklar.

## User Stories

1. Bir izleyici olarak hesap açmadan test başlatmak istiyorum, böylece hemen sonuç alabilirim.
2. Bir izleyici olarak Twitch linki girmek istiyorum, böylece Twitch yayınını inceleyebilirim.
3. Bir izleyici olarak Kick linki girmek istiyorum, böylece Kick yayınını inceleyebilirim.
4. Bir izleyici olarak geçersiz veya desteklenmeyen bir linkin neden kabul edilmediğini görmek istiyorum, böylece düzeltebilirim.
5. Bir izleyici olarak testten önce 30 saniye veya 1 dakika seçmek ve ilerlemeyi görmek istiyorum, böylece bekleyişi anlayabilirim.
6. Bir izleyici olarak yayının açık olup olmadığını görmek istiyorum, böylece test durumunu anlayabilirim.
7. Bir izleyici olarak mevcut çözünürlükleri ve kare hızlarını görmek istiyorum, böylece seçenekleri anlayabilirim.
8. Bir izleyici olarak görüntü codec bilgisini görmek istiyorum, böylece yayın biçimini öğrenebilirim.
9. Bir izleyici olarak ses codec bilgisini görmek istiyorum, böylece sesin nasıl kodlandığını öğrenebilirim.
10. Bir izleyici olarak mevcut ses kodlama özelliklerine dayanan kısa bir kalite beklentisi görmek istiyorum, böylece sonucu yorumlayabilirim.
11. Bir izleyici olarak gözlem süresindeki takılma ve kesintilerin sayısını görmek istiyorum, böylece oynatmanın istikrarını anlayabilirim.
12. Bir izleyici olarak toplam takılma süresini ve doğrulanmış ölçüm hata payını görmek istiyorum, böylece ölçümün hassasiyetini anlayabilirim.
13. Bir izleyici olarak ölçülen dijital ses seviyesini görmek istiyorum, böylece yayındaki ses sinyalini değerlendirebilirim.
14. Bir izleyici olarak sesin algılanıp algılanmadığını veya çok düşük olduğunu görmek istiyorum, böylece sessiz bir yayını fark edebilirim.
15. Bir izleyici olarak her bulguyu ilgili kutucukta görmek istiyorum, böylece çıktıyı kolayca okuyabilirim.
16. Bir izleyici olarak yayının çevrimdışı olduğunu görmek istiyorum, böylece testin neden yapılamadığını anlayabilirim.
17. Bir izleyici olarak kesilen testte elde edilen sonuçları ve tamamlanamama nedenini görmek istiyorum, böylece kısmi sonucu anlayabilirim.
18. Bir izleyici olarak gözlem süresini görmek istiyorum, böylece sonucun sınırlarını anlayabilirim.

## Implementation Decisions

- İlk sürüm hem Twitch hem Kick yayınlarını hedefler. Platform erişimi ve gerekli yayın verilerinin elde edilmesi uygulama sırasında doğrulanmalıdır; erişim sağlanamadığında başarısızlık dürüstçe gösterilir.
- Bağımsız test ortamı kullanılır; kullanıcının cihazı veya ses ayarları teşhis edilmez.
- Twitch testi, resmî Twitch Embed oynatıcısını uygulamanın sunucu tarafı tarayıcısında açar. Böylece ölçüm ziyaretçinin cihazında değil test hizmetinin ortamında çalışır. Embed’in `parent` değeri genel host adıyla eşleşmeli; canlı ortam HTTPS kullanmalıdır.
- Kick testi, resmî `player.kick.com` gömülü oynatıcısını aynı sunucu tarafı tarayıcısında açar ve oynatmanın ilerlediğini doğrular.
- Twitch'in güncel çözünürlüğü, FPS değeri ve kalite seçenekleri resmî oynatıcı istatistiklerinden alınır. Kick'te güncel çözünürlük video öğesinden, FPS değeri sunucu oynatıcısının video-kare bildirimlerinden, kalite seçenekleri ise varsa HLS ana listesinden alınır.
- Twitch'te oynatıcının resmî kalite API'si üzerinden önce kullanılabilir 1080p seçeneği, yoksa özgün kaynak kalite seçeneği (`chunked`) istenir. Gerçek seçili kalite ve mevcut çözünürlük ayrıca raporlanır. Kick için resmî gömülü oynatıcı belgesi programatik kalite seçme API'si sunmadığından yalnızca mevcut kalite ölçülür.
- Twitch codec kimlikleri oynatıcı istatistiklerinden, Kick codec kimlikleri HLS ana listesinin `CODECS` alanından alınır. Tanınan kimlikler okunabilir adla birlikte gösterilir; bulunmayan bilgi tahmin edilmez. Ses codec notu sıkıştırma ailesini açıklar ve codec adının tek başına algılanan kaliteyi belirlemediğini söyler.
- Takılma süresi, gömülü oynatıcının video öğesindeki HTML `waiting` ve `playing` olaylarının aynı frame içindeki zaman damgalarıyla ölçülür. İlk `playing` olayı gözlemi başlatır; her sonraki `waiting`/`playing` çifti bir takılmadır. Kontrollü oynatıcı kesintileri ve bağımsız video zamanı karşılaştırmaları ±0,5 saniye hata payını destekler; ölçüm sinyali alınamazsa değer uydurulmaz.
- Kullanıcı testten önce 30 saniye veya 1 dakika seçer; varsayılan 30 saniyedir. Testin gözlem ve hata süresi seçilen toplam süreye göre gösterilir.
- Test çıktısı yayın durumu, çözünürlük ve kare hızı, video ve ses codec bilgileri, takılmalar ve ses seviyesi için ayrı kutucuklarda sunulur.
- Oynatma beklemelerinin sayısı ve toplam süresi raporlanır. Hata payı ölçüm yönteminin doğrulanmış hassasiyetine dayanır; doğrulanmamış kesinlik iddia edilmez.
- Dijital ses seviyesi dBFS olarak ve ölçülebilen örneklerin ortalama RMS'i üzerinden gösterilir: < −60 dBFS “sinyal algılanmadı,” −60 ile < −35 dBFS “çok düşük,” ≥ −35 dBFS “sinyal var.” Eşikler temsilî sessiz, düşük ve normal örneklerle doğrulanmış ilk sürüm ürün sezgisidir; sesin türü ayrıştırılmaz. Kapsama en az %90 ise tam ölçüm, kapsama daha düşük ama en az 5 saniyelik örnek varsa kısmi ölçüm olarak işaretlenir; dBFS yalnızca örneklenen aralıklara aittir. Ölçüm yolu belirsizse, örnek yoksa veya 5 saniyeden azsa değer gösterilmez. dBFS fiziksel duyulabilirliği ölçmez.
- Codec kalite beklentisi kısa ve eldeki verilere dayanır; codec tek başına gerçek kaliteyi kanıtlamaz. Kullanıcının fiziksel ortamında duyulabilirlik iddia edilmez.
- Test tamamlanamazsa mevcut bulgular ve durum gösterilir; ölçülemeyen değerler uydurulmaz.

## Testing Decisions

- Testler link verilmesinden test sonucunun gösterilmesine kadar uygulamanın dışarıdan gözlenebilir HTTP davranışını ve bağımsız test akışını doğrular; iç uygulama ayrıntılarını taklit etmez.
- Twitch ve Kick için canlı bir yayın, sunucu tarafı Chromium işçisi üzerinden yaklaşık 30 saniye gözlemlenerek uçtan uca doğrulanmıştır. Sonraki ölçüm kutucukları kendi biletlerinde doğrulanır.
- Codec bileti için Twitch ve Kick canlı yayınları ayrı ayrı 30 saniye gözlemlendi; her ikisinde H.264 / AVC ve AAC-LC tanındı. Kontrollü HLS manifesti, codec verisi bulunmayan durum ve codec sonucu kartı yerel testlerle kapsanır.
- Takılma bileti için Twitch ve Kick canlı yayınları ayrı ayrı 30 saniye gözlemlendi ve ikisinde de takılma çıkmadı. Her iki oynatıcıda HLS segment gecikmesiyle kesinti oluşturuldu. Beş kontrollü kesintide olay aralığı bağımsız video zamanı ilerlemesiyle karşılaştırıldı; en büyük fark 306 ms çıktı ve 0,5 sn pay seçildi.
- Ses bileti için sessiz, −45 dBFS RMS ve −20 dBFS RMS yerel WAV örnekleri Chromium'da sınıflandırıldı. AudioWorklet ile önceki canlı Twitch ve Kick yayınları 30 saniye ölçüldü: sırasıyla −31,1 ve −8,4 dBFS; örnek kapsaması ikisinde de %99,9 oldu. Sonraki düşük kapsama durumlarında en az 5 saniyelik örnek varsa seviye kısmi olarak raporlanır; %90 altı tam ölçüm sayılmaz.
- Kısmi sonuç bileti için kontrollü işçi kesintisi ve yayın ortasında çevrimdışı olma durumları yerel HTTP/UI testleriyle doğrulanır; test durumu, gözlem süresi ve kesintiden önce elde edilen görüntü, codec, takılma ve ses verileri korunur.
- Geçersiz link, test oluşturma ve sonuç sorgulama davranışları yerel HTTP entegrasyon testleriyle kapsanır.

## Out of Scope

Üyelik, kullanıcının cihazına özel teşhis veya çözüm, konuşma ve müzik ayrımı ve 1 dakikadan daha kapsamlı testler.

## Further Notes

Ses seviyesi sınıflandırma eşikleri ve dijital ses ölçüm yöntemi, 06 numaralı bilette araştırılıp doğrulanmalıdır.
