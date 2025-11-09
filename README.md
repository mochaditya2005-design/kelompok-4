# kelompok-4

Deskripsi Singkat
Aplikasi web single-page ini adalah simulator lengkap untuk aljabar Boolean. Aplikasi ini memungkinkan pengguna untuk mengevaluasi ekspresi Boolean, menghasilkan Tabel Kebenaran (TT) secara otomatis, memanipulasi Karnaugh Map (K-Map) secara interaktif, dan mendapatkan ekspresi yang paling sederhana menggunakan algoritma Quine-McCluskey.

Proyek ini dibangun murni menggunakan HTML, CSS, dan JavaScript vanilla (murni), tanpa library atau framework eksternal, sesuai dengan pedoman kualitas kode.
✨ Fitur Utama
Aplikasi ini mencakup fungsionalitas berikut:

Evaluasi Ekspresi:
Parser ekspresi yang mendukung operator NOT (A', !A, ~A), AND (A*B, A.B, A&B, AB), OR (A+B, A|B), dan XOR (A^B).
Dukungan penuh untuk prioritas operator dan tanda kurung ().
Menekan tombol Enter di kotak input akan memicu evaluasi.
Deteksi Otomatis:
Ukuran K-Map (2, 3, atau 4 variabel) dideteksi secara otomatis berdasarkan ekspresi yang dimasukkan.
Panel "Konteks Variabel" diperbarui secara otomatis.
Tabel Kebenaran (TT):
Dihasilkan secara otomatis dari ekspresi yang dievaluasi.
Juga dihasilkan secara otomatis saat mengimpor minterm.
Karnaugh Map (K-Map):
Tampilan K-Map 2, 3, atau 4 variabel yang digambar secara dinamis.
Label sumbu K-Map menggunakan urutan Gray Code yang benar.
Setiap sel dapat diklik untuk siklus nilai 0 → 1 → d (Don't Care).
Menampilkan nomor minterm kecil di setiap sel untuk referensi.
Penyederhanaan (Quine-McCluskey):
Implementasi algoritma Quine-McCluskey (QM) untuk penyederhanaan.
Tombol "Sederhanakan SOP" untuk mendapatkan Sum of Products minimal (berdasarkan sel '1' dan 'd').
Tombol "Sederhanakan POS" untuk mendapatkan Product of Sums minimal (berdasarkan sel '0' dan 'd').
Impor / Ekspor:
Impor Minterm: Mengisi K-Map dan Tabel Kebenaran berdasarkan daftar minterm. Otomatis mendeteksi ukuran K-Map yang diperlukan.
Ekspor Minterm: Mengekspor minterm ('1') dan don't care ('d') dari K-Map saat ini.
Ekspor Visual:
Download PNG: Menyimpan K-Map saat ini sebagai file gambar .png (dibuat murni dengan JS via SVG-ke-Canvas).
Cetak/PDF: Membuka dialog cetak browser dengan format khusus (@media print) yang hanya menampilkan K-Map untuk pencetakan rapi atau "Simpan sebagai PDF".
Antarmuka (UI/UX):
Mode Tema: Toggle Mode Gelap (Hitam/Oranye) dan Mode Terang (Biru Tua/Hitam "XNXX style").
Logo Kustom: Menampilkan logo "TIF HUB" yang gayanya berubah sesuai tema (Gaya Pornhub di mode gelap, gaya XNXX glossy di mode terang).
Benchmark: Menampilkan waktu eksekusi (ms) algoritma QM di panel statistik.
Contoh Uji (F1-F10): 10 tombol untuk memuat ekspresi yang sudah disiapkan.
Inisialisasi Kosong: Aplikasi dimuat dalam keadaan bersih dan siap pakai.
Tooltips: Petunjuk muncul saat mengarahkan mouse ke tombol-tombol utama.
🚀 Cara Menjalankan
Aplikasi ini adalah aplikasi web statis. Tidak diperlukan server atau proses build.

Pastikan Anda memiliki semua file (index.html, style.css, app.js) dalam satu folder.
Buka file index.html menggunakan browser web modern (Chrome, Firefox, Edge, Safari).
Aplikasi siap digunakan.
⚙️ Cara Pakai (Alur Kerja)
Ada tiga alur kerja utama:
Alur 1: Dari Ekspresi Boolean
Ketik ekspresi Boolean Anda di kotak "Ekspresi Boolean" (Contoh: A'B + AC).
Tekan tombol "Evaluasi" atau tekan Enter pada keyboard.
Hasil:
Panel "Konteks Variabel", "Minterm (m)", dan "Sederhana / Waktu QM" akan terisi.
"Tabel Kebenaran" akan digambar.
"Karnaugh Map" akan digambar dan diisi (sel '1' akan berwarna hijau/biru).
"Ekspresi Tersederhana" akan menampilkan hasil SOP otomatis.
Alur 2: Dari Input K-Map Manual
Klik tombol "Bersihkan" untuk mengosongkan board.
Klik sel-sel pada "Karnaugh Map" untuk mengubah nilainya menjadi 1 (on) atau d (don't care).
Klik tombol "Sederhanakan SOP" atau "Sederhanakan POS".
Hasil: "Ekspresi Tersederhana" akan diperbarui dengan hasil minimal, dan kotak "Ekspresi Boolean" juga akan diisi.
Alur 3: Dari Impor Minterm
Klik tombol "Bersihkan".
Ketik daftar minterm (dipisah koma atau spasi) di kotak "Minterm (impor/ekspor)" (Contoh: 4 5 12 13).
Klik tombol "Impor Minterm → K-Map".
Hasil: Aplikasi akan otomatis mendeteksi ukuran K-Map yang benar (4-var untuk contoh ini), menggambar K-Map, mengisi Tabel Kebenaran, dan menampilkan hasil SOP yang disederhanakan.


🔬 Kualitas Kode
Proyek ini mematuhi pedoman kualitas kode yang ketat:

Struktur Rapi: Kode di app.js dibagi menjadi bagian-bagian logis (Utils, Parser, QM, K-Map, UI) dengan komentar yang jelas.
Modularitas: Fitur-fitur baru (seperti POS, Benchmark, Ekspor PNG) ditambahkan sebagai fungsi modular yang memanggil logika inti (Parser/QM) tanpa mengubahnya secara ceroboh.
Daftar Skenario Uji
Berikut adalah 10 kasus uji standar (F1-F10) yang ada di aplikasi, ditambah 4 kasus (Mudah, Sedang, Kompleks, Error) untuk demo "live":

daftar uji
Tipe
Ekspresi Input
Minterm (Otomatis)
Hasil SOP (Otomatis)
F1
A'B + AC
2,3,5,7
A'B + AC
F2
A(B+C)
5,6,7
AB + AC
F3
(A^B)C + A'B'
0,1,3,5
A'B' + AC + BC'
F4
(A+B)(C+D)
5,6,7,9,10,11,13,14,15
AC + AD + BC + BD
F5
A'B'+AB
0,3
A'B' + AB
F6
A^B^C
1,2,4,7
A'B'C + A'BC' + AB'C' + ABC
F7
(A+B'C')(A'+C)
0,5,7
A'B' + AC
F8
(AB)'+C
0,1,2,3,4,5,7
A' + B' + C
F9
AB+AC+BC
3,5,6,7
AB + BC + AC
F10
(A+B+C)(A'+B)(B+C')
2,3,6,7
A'B + BC'
Mudah
A' + B
0,1,3
A' + B
Sedang
A'BC' + AB'C + ABC
2,5,7
AC + A'BC'
Kompleks
(Impor Minterm) 4,5,6,7,12,13,14,15
...
B
Error
(A+B
-
Pesan Error Ditampilkan

👥 Anggota Tim & Kontribusi
Proyek ini dikembangkan oleh 6 anggota tim. (Silakan isi bagian ini sesuai dengan peran tim Anda)

No.
Nama Anggota:
pengerjaan makalah
-ahmad irham al azizi
-dwi maryati mannuputy

pengerjaan power point
-nur hartika
-m.zahy al abiyyu

pengerjaan source code dan test aplikasi
-moch.aditya santoso
-m.ganis saputra


