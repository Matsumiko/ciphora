import {
  ArrowLeft,
  ArrowRight,
  EnvelopeSimple,
  FileText,
  Globe,
  LockKey,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import BrandLogo from "@/components/BrandLogo";
import { APP_NAME, APP_PUBLIC_URL, APP_VERSION } from "../lib/app-config";
import { ROUTE_PATHS } from "../lib/routes";
import { useI18n, type Locale } from "@/lib/i18n";

export type PublicPageKind = "about" | "contact" | "terms" | "privacy";

type PublicPageContent = {
  eyebrow: string;
  title: string;
  summary: string;
  updated: string;
  facts: Array<{ label: string; value: string }>;
  sections: Array<{ title: string; body: string[] }>;
  calloutTitle: string;
  calloutText: string;
};

const CONTACT_EMAIL = "support@ciphora.indevs.in";

const commonCopy: Record<Locale, {
  home: string;
  about: string;
  contact: string;
  terms: string;
  privacy: string;
  backHome: string;
  openVault: string;
  officialPage: string;
  pageIndex: string;
  version: string;
  contactEmail: string;
  publicUrl: string;
  footer: string;
}> = {
  id: {
    home: "Beranda",
    about: "Tentang",
    contact: "Kontak",
    terms: "Syarat",
    privacy: "Privasi",
    backHome: "Kembali ke Beranda",
    openVault: "Open Vault",
    officialPage: "Halaman resmi Ciphora",
    pageIndex: "Navigasi halaman",
    version: "Versi aplikasi",
    contactEmail: "Email kontak",
    publicUrl: "URL resmi",
    footer: "Ciphora menyimpan vault secara lokal secara default dan memakai sync milik pengguna hanya jika diaktifkan.",
  },
  en: {
    home: "Home",
    about: "About",
    contact: "Contact",
    terms: "Terms",
    privacy: "Privacy",
    backHome: "Back to Home",
    openVault: "Open Vault",
    officialPage: "Official Ciphora page",
    pageIndex: "Page navigation",
    version: "App version",
    contactEmail: "Contact email",
    publicUrl: "Official URL",
    footer: "Ciphora keeps vault data local by default and uses user-owned sync only when enabled.",
  },
};

const pages: Record<Locale, Record<PublicPageKind, PublicPageContent>> = {
  id: {
    about: {
      eyebrow: "Tentang Kami",
      title: "Tentang Ciphora",
      summary: "Ciphora adalah aplikasi vault terenkripsi local-first untuk mengelola password, TOTP, secure notes, data recovery, dan sync opsional dengan database milik pengguna.",
      updated: "Berlaku sejak 26 April 2026",
      facts: [
        { label: "Operator", value: "Ciphora" },
        { label: "Model layanan", value: "Local-first encrypted vault" },
        { label: "Kontak resmi", value: CONTACT_EMAIL },
      ],
      sections: [
        {
          title: "Identitas dan ruang lingkup",
          body: [
            "Ciphora mengoperasikan aplikasi web di app.ciphora.indevs.in untuk membantu pengguna menyimpan dan mengelola rahasia digital secara terenkripsi.",
            "Halaman ini menjelaskan karakter produk secara umum. Ketentuan penggunaan dan pemrosesan data diatur lebih rinci pada halaman Syarat & Ketentuan dan Kebijakan Privasi.",
          ],
        },
        {
          title: "Model keamanan local-first",
          body: [
            "Vault aktif dirancang untuk tetap berada di browser pengguna sebagai data terenkripsi. Master password, root key, Recovery Key, dan plaintext isi vault tidak dimaksudkan untuk dikirim ke server Ciphora.",
            "Akun Ciphora, jika digunakan, berfungsi untuk autentikasi, email verification, recovery gate, session management, dan penyimpanan profil sync terenkripsi. Akun tidak memberi Ciphora akses ke isi vault plaintext.",
          ],
        },
        {
          title: "Sync dengan database milik pengguna",
          body: [
            "Sync bersifat opsional melalui model BYODB. Pengguna dapat membawa provider sendiri seperti Turso, Cloudflare D1, D1 Bridge, D1 Direct, atau HTTP Bridge kompatibel Ciphora.",
            "Kredensial provider dipakai di browser yang sedang unlocked. Jika profil sync disimpan ke akun Ciphora, profil tersebut disimpan sebagai ciphertext yang dibungkus dengan kunci vault pengguna.",
          ],
        },
        {
          title: "Batasan jaminan",
          body: [
            "Ciphora sedang dikembangkan secara aktif. Pengguna harus tetap menjaga master password, Recovery Key, backup terenkripsi, perangkat, browser, dan kredensial provider masing-masing.",
            "Ciphora tidak boleh dipromosikan sebagai produk yang telah mendapat audit kriptografi independen atau sertifikasi kepatuhan formal sebelum bukti review eksternal tersedia.",
          ],
        },
      ],
      calloutTitle: "Prinsip utama",
      calloutText: "Ciphora meminimalkan data yang dipercayakan ke server. Server mengelola akun dan ciphertext tertentu; kendali vault, kunci, backup, dan provider tetap berada pada pengguna.",
    },
    contact: {
      eyebrow: "Kontak",
      title: "Kontak Ciphora",
      summary: "Gunakan alamat kontak resmi Ciphora untuk dukungan produk, permintaan privasi, laporan keamanan, dan korespondensi terkait layanan.",
      updated: "Berlaku sejak 26 April 2026",
      facts: [
        { label: "Email resmi", value: CONTACT_EMAIL },
        { label: "Status inbox", value: "Aktif dan dimonitor" },
        { label: "Domain layanan", value: "ciphora.indevs.in" },
      ],
      sections: [
        {
          title: "Dukungan produk",
          body: [
            `Untuk pertanyaan produk, bug UI, atau masalah akun, kirim email ke ${CONTACT_EMAIL}. Sertakan ringkasan masalah, jenis browser, route yang dibuka, waktu kejadian, dan langkah reproduksi yang aman.`,
            "Untuk masalah BYODB sync, sebutkan jenis provider dan gejala teknisnya tanpa menyertakan token, secret URL, password database, private key, atau isi database.",
          ],
        },
        {
          title: "Permintaan privasi dan akun",
          body: [
            "Untuk permintaan terkait data akun, verifikasi email, session, atau penghapusan akun, gunakan subjek email yang jelas seperti Privacy Request atau Account Request.",
            "Ciphora dapat meminta bukti kepemilikan akun yang wajar sebelum memproses permintaan, tetapi tidak akan meminta master password, Recovery Key, atau plaintext isi vault.",
          ],
        },
        {
          title: "Laporan keamanan",
          body: [
            "Untuk laporan kerentanan, sertakan deskripsi teknis, dampak, route atau endpoint terkait, langkah reproduksi, dan batasan lingkungan pengujian.",
            "Jangan mengeksploitasi data pihak lain, melakukan destructive testing, scraping massal, social engineering, atau percobaan akses di luar akun dan lingkungan yang Anda miliki izin untuk uji.",
          ],
        },
        {
          title: "Informasi yang tidak boleh dikirim",
          body: [
            "Jangan mengirim master password, Recovery Key, seed phrase, private key, TOTP secret, token BYODB, password database, CVV, file backup penuh, atau isi vault plaintext melalui email.",
            "Jika screenshot dibutuhkan, redaksi semua secret, alamat email pribadi, token, URL sensitif, dan informasi akun pihak ketiga terlebih dahulu.",
          ],
        },
      ],
      calloutTitle: "Jangan kirim rahasia",
      calloutText: `Alamat ${CONTACT_EMAIL} aktif untuk korespondensi resmi, tetapi tetap gunakan prinsip minimisasi data: kirim metadata masalah, bukan rahasia vault.`,
    },
    terms: {
      eyebrow: "Syarat & Ketentuan",
      title: "Syarat & Ketentuan Ciphora",
      summary: "Dokumen ini mengatur akses dan penggunaan Ciphora, termasuk tanggung jawab pengguna atas vault lokal, akun, recovery, backup, dan provider BYODB.",
      updated: "Berlaku sejak 26 April 2026",
      facts: [
        { label: "Penerimaan", value: "Dengan menggunakan layanan" },
        { label: "Hukum acuan", value: "Indonesia, jika berlaku" },
        { label: "Kontak", value: CONTACT_EMAIL },
      ],
      sections: [
        {
          title: "Penerimaan syarat",
          body: [
            "Dengan mengakses atau menggunakan Ciphora, pengguna menyatakan telah membaca, memahami, dan menyetujui Syarat & Ketentuan ini.",
            "Jika pengguna tidak setuju, pengguna harus berhenti menggunakan layanan dan dapat menghapus data lokal dari browser atau melakukan export backup sebelum berhenti.",
          ],
        },
        {
          title: "Definisi layanan",
          body: [
            "Ciphora adalah aplikasi vault terenkripsi local-first. Fitur utama meliputi penyimpanan item vault lokal, generator, TOTP, export/import backup terenkripsi, akun opsional, recovery gate, dan sync opsional dengan provider milik pengguna.",
            "Fitur akun dan sync tidak mengubah prinsip dasar bahwa plaintext isi vault, master password, root key, dan Recovery Key tidak dimaksudkan untuk disimpan oleh server Ciphora.",
          ],
        },
        {
          title: "Kewajiban pengguna",
          body: [
            "Pengguna bertanggung jawab menjaga keamanan perangkat, browser, master password, Recovery Key, backup terenkripsi, email akun, session, dan kredensial provider BYODB.",
            "Pengguna wajib memastikan bahwa setiap data yang disimpan atau disinkronkan melalui Ciphora adalah data yang secara sah berhak dikelola oleh pengguna.",
          ],
        },
        {
          title: "Akun, autentikasi, dan recovery",
          body: [
            "Ciphora dapat menyediakan mekanisme akun, email verification, session management, password change, Recovery Key setup, dan email-backed recovery gate.",
            "Reset login akun tidak sama dengan pemulihan vault. Jika pengguna kehilangan master password, Recovery Key, backup terenkripsi, dan akses provider sync, vault dapat menjadi tidak dapat dipulihkan.",
          ],
        },
        {
          title: "Sync BYODB dan provider pihak ketiga",
          body: [
            "BYODB sync memakai provider yang dipilih dan dikelola pengguna. Ketersediaan, kuota, billing, CORS, keamanan token, aturan provider, dan perubahan layanan pihak ketiga berada di luar kendali langsung Ciphora.",
            "Pengguna bertanggung jawab membatasi scope token provider dan tidak memasukkan token yang memberi akses lebih luas dari kebutuhan sync.",
          ],
        },
        {
          title: "Larangan penggunaan",
          body: [
            "Pengguna dilarang memakai Ciphora untuk aktivitas ilegal, akses tanpa izin, penyimpanan kredensial yang diperoleh secara tidak sah, pelanggaran hak pihak ketiga, atau upaya mengganggu layanan.",
            "Pengguna dilarang melakukan reverse engineering yang melanggar hukum, eksploitasi sistem, scraping massal, abuse API, atau pengujian keamanan di luar batas izin yang sah.",
          ],
        },
        {
          title: "Ketersediaan dan perubahan layanan",
          body: [
            "Ciphora dapat berubah, diperbaiki, dibatasi, dihentikan sementara, atau dihentikan sebagian untuk alasan keamanan, pemeliharaan, perubahan arsitektur, atau kepatuhan.",
            "Pengguna dianjurkan menyimpan backup terenkripsi dan Recovery Key secara aman karena Ciphora tidak menjamin ketersediaan permanen atas data lokal yang berada di browser pengguna.",
          ],
        },
        {
          title: "Penafian dan batas tanggung jawab",
          body: [
            "Sepanjang diizinkan hukum yang berlaku, Ciphora disediakan sebagaimana adanya dan sebagaimana tersedia, tanpa jaminan bahwa layanan bebas dari error, selalu tersedia, atau sesuai untuk seluruh kebutuhan khusus pengguna.",
            "Ciphora tidak bertanggung jawab atas kehilangan akses yang disebabkan oleh hilangnya master password, Recovery Key, backup, penghapusan storage browser, kompromi perangkat, kesalahan konfigurasi provider, atau kegagalan layanan pihak ketiga.",
          ],
        },
        {
          title: "Hukum yang berlaku",
          body: [
            "Sepanjang tidak ditentukan lain oleh hukum wajib di wilayah pengguna, Syarat & Ketentuan ini ditafsirkan berdasarkan hukum Republik Indonesia.",
            "Jika ada bagian yang tidak dapat diberlakukan, bagian lainnya tetap berlaku sejauh diizinkan hukum.",
          ],
        },
      ],
      calloutTitle: "Recovery adalah tanggung jawab bersama",
      calloutText: "Ciphora menyediakan alur teknis untuk membantu keamanan akun dan recovery, tetapi pengguna tetap menjadi pihak utama yang memegang kunci, backup, dan akses provider.",
    },
    privacy: {
      eyebrow: "Kebijakan Privasi",
      title: "Kebijakan Privasi Ciphora",
      summary: "Kebijakan ini menjelaskan kategori data yang diproses Ciphora, tujuan pemrosesan, retensi, hak pengguna, serta batasan penting bahwa plaintext isi vault tidak dimaksudkan untuk dikirim ke server Ciphora.",
      updated: "Berlaku sejak 26 April 2026",
      facts: [
        { label: "Kontak privasi", value: CONTACT_EMAIL },
        { label: "Vault plaintext", value: "Tidak disimpan server" },
        { label: "Profil sync", value: "Ciphertext" },
      ],
      sections: [
        {
          title: "Pengendali dan kontak privasi",
          body: [
            `Ciphora adalah operator layanan untuk aplikasi di ${APP_PUBLIC_URL}. Untuk pertanyaan privasi, permintaan data, atau keberatan pemrosesan, hubungi ${CONTACT_EMAIL}.`,
            "Permintaan dapat memerlukan verifikasi kepemilikan akun yang wajar agar data akun tidak diberikan kepada pihak yang tidak berwenang.",
          ],
        },
        {
          title: "Kategori data yang diproses",
          body: [
            "Jika pengguna memakai akun, Ciphora dapat memproses email dalam bentuk hash atau alias terproteksi, status verifikasi email, metadata session/device, audit event terbatas, recovery metadata, dan root-key wrapper terenkripsi.",
            "Jika pengguna mengaktifkan sync profile akun, Ciphora dapat menyimpan ciphertext profil sync, tipe provider, label aman, timestamps, dan metadata operasional yang diperlukan untuk load, update, atau disconnect profile.",
            "Ciphora juga dapat memproses data teknis terbatas seperti waktu request, endpoint, rate-limit key ter-hash, dan informasi keamanan yang diperlukan untuk mencegah penyalahgunaan.",
          ],
        },
        {
          title: "Data yang tidak disimpan sebagai plaintext",
          body: [
            "Ciphora tidak dimaksudkan untuk menerima atau menyimpan master password, Recovery Key plaintext, root key, password item vault, TOTP secret plaintext, private key, seed phrase, CVV, token provider plaintext, atau isi vault plaintext.",
            "Jika pengguna secara sengaja mengirimkan secret melalui email dukungan atau kanal lain, Ciphora dapat meminta pengguna menghapus atau merotasi secret tersebut karena kanal dukungan bukan tempat penyimpanan rahasia.",
          ],
        },
        {
          title: "Tujuan dan dasar pemrosesan",
          body: [
            "Data diproses untuk menyediakan akun, autentikasi, session, email verification, recovery gate, sync profile terenkripsi, keamanan layanan, rate limiting, audit keamanan, dukungan pengguna, dan pemenuhan kewajiban hukum yang berlaku.",
            "Dasar pemrosesan dapat meliputi pelaksanaan layanan yang diminta pengguna, kepentingan sah untuk keamanan dan pencegahan penyalahgunaan, persetujuan jika diperlukan, serta kepatuhan terhadap kewajiban hukum yang berlaku.",
          ],
        },
        {
          title: "Penyimpanan lokal dan BYODB",
          body: [
            "Vault lokal disimpan di browser pengguna sebagai envelope terenkripsi. Penghapusan storage browser dapat menghapus akses lokal jika pengguna tidak memiliki backup terenkripsi, Recovery Key, atau sync profile yang masih dapat digunakan.",
            "Provider BYODB berada di akun pengguna. Data yang dikirim ke provider tersebut adalah ciphertext atau metadata sync yang diperlukan. Kebijakan privasi dan keamanan provider berlaku untuk layanan yang pengguna pilih.",
          ],
        },
        {
          title: "Penyedia layanan dan transfer data",
          body: [
            "Ciphora dapat memakai penyedia infrastruktur dan email transaksi seperti Cloudflare Pages/Functions, Cloudflare D1, Brevo, Resend, dan Turso archive foundation untuk menjalankan layanan.",
            "Penyedia tersebut dapat memproses data operasional sesuai perannya sebagai penyedia layanan. Lokasi pemrosesan dapat berbeda dari negara pengguna, bergantung pada infrastruktur penyedia.",
          ],
        },
        {
          title: "Retensi",
          body: [
            "Data akun disimpan selama akun aktif atau selama diperlukan untuk keamanan, audit terbatas, penyelesaian sengketa, pemenuhan hukum, atau pencegahan penyalahgunaan.",
            "Session dan challenge yang bersifat sementara dibatasi masa berlakunya dan dapat dicabut. Email verification dan recovery token dirancang short-lived dan single-use jika memungkinkan.",
            "Data lokal di browser tetap berada di perangkat pengguna sampai pengguna menghapusnya, mereset local storage, mengganti browser, atau browser menghapus storage.",
          ],
        },
        {
          title: "Hak pengguna",
          body: [
            "Bergantung pada hukum yang berlaku, pengguna dapat meminta akses, koreksi, penghapusan, pembatasan pemrosesan, portabilitas, penarikan persetujuan, atau mengajukan keberatan atas pemrosesan data pribadi tertentu.",
            `Permintaan dapat dikirim ke ${CONTACT_EMAIL}. Ciphora akan memproses permintaan yang sah sepanjang dapat diverifikasi dan tidak bertentangan dengan kewajiban hukum, keamanan, atau hak pihak lain.`,
          ],
        },
        {
          title: "Anak-anak",
          body: [
            "Ciphora tidak ditujukan untuk anak-anak yang belum memiliki kapasitas hukum untuk menyetujui penggunaan layanan digital sesuai hukum yang berlaku.",
            "Jika diketahui ada akun yang dibuat tanpa dasar persetujuan yang sah, Ciphora dapat mengambil tindakan pembatasan atau penghapusan sesuai konteks.",
          ],
        },
        {
          title: "Perubahan kebijakan",
          body: [
            "Ciphora dapat memperbarui Kebijakan Privasi ini untuk mencerminkan perubahan layanan, keamanan, hukum, atau operasional.",
            "Perubahan material akan ditampilkan melalui halaman ini atau mekanisme pemberitahuan lain yang wajar. Penggunaan layanan setelah perubahan berlaku dianggap sebagai penerimaan terhadap kebijakan yang diperbarui sepanjang diizinkan hukum.",
          ],
        },
      ],
      calloutTitle: "Privasi by design",
      calloutText: "Desain Ciphora mengikuti prinsip minimisasi data: server menangani akun, keamanan, dan ciphertext tertentu; isi vault plaintext tetap berada di bawah kendali pengguna.",
    },
  },
  en: {
    about: {
      eyebrow: "About",
      title: "About Ciphora",
      summary: "Ciphora is a local-first encrypted vault application for managing passwords, TOTP, secure notes, recovery data, and optional sync with user-owned databases.",
      updated: "Effective April 26, 2026",
      facts: [
        { label: "Operator", value: "Ciphora" },
        { label: "Service model", value: "Local-first encrypted vault" },
        { label: "Official contact", value: CONTACT_EMAIL },
      ],
      sections: [
        {
          title: "Identity and scope",
          body: [
            "Ciphora operates the web application at app.ciphora.indevs.in to help users store and manage digital secrets in encrypted form.",
            "This page describes the product at a high level. Use of the service and personal data processing are governed in more detail by the Terms & Conditions and Privacy Policy pages.",
          ],
        },
        {
          title: "Local-first security model",
          body: [
            "The active vault is designed to remain in the user's browser as encrypted data. Master passwords, root keys, Recovery Keys, and vault item plaintext are not intended to be sent to Ciphora servers.",
            "A Ciphora account, when used, supports authentication, email verification, recovery gates, session management, and encrypted sync profile storage. It does not give Ciphora access to vault plaintext.",
          ],
        },
        {
          title: "User-owned database sync",
          body: [
            "Sync is optional through a BYODB model. Users may bring providers such as Turso, Cloudflare D1, D1 Bridge, D1 Direct, or Ciphora-compatible HTTP Bridge providers.",
            "Provider credentials are used in the unlocked browser. If a sync profile is stored in a Ciphora account, that profile is stored as ciphertext wrapped with user-controlled vault key material.",
          ],
        },
        {
          title: "Warranty boundaries",
          body: [
            "Ciphora is under active development. Users remain responsible for protecting their master password, Recovery Key, encrypted backups, devices, browsers, and provider credentials.",
            "Ciphora should not be marketed as independently cryptographically audited or formally compliance-certified until external review evidence exists.",
          ],
        },
      ],
      calloutTitle: "Core principle",
      calloutText: "Ciphora minimizes what must be trusted to the server. The server handles account state and selected ciphertext; vault control, keys, backups, and providers remain user-owned.",
    },
    contact: {
      eyebrow: "Contact",
      title: "Contact Ciphora",
      summary: "Use Ciphora's official contact address for product support, privacy requests, security reports, and service-related correspondence.",
      updated: "Effective April 26, 2026",
      facts: [
        { label: "Official email", value: CONTACT_EMAIL },
        { label: "Inbox status", value: "Active and monitored" },
        { label: "Service domain", value: "ciphora.indevs.in" },
      ],
      sections: [
        {
          title: "Product support",
          body: [
            `For product questions, UI bugs, or account issues, email ${CONTACT_EMAIL}. Include a concise summary, browser type, route, event time, and safe reproduction steps.`,
            "For BYODB sync issues, name the provider and symptoms without sharing tokens, secret URLs, database passwords, private keys, or database contents.",
          ],
        },
        {
          title: "Privacy and account requests",
          body: [
            "For account data, email verification, session, or account deletion requests, use a clear email subject such as Privacy Request or Account Request.",
            "Ciphora may request reasonable account ownership verification before processing a request, but will not ask for your master password, Recovery Key, or vault plaintext.",
          ],
        },
        {
          title: "Security reports",
          body: [
            "For vulnerability reports, include the technical description, impact, affected route or endpoint, reproduction steps, and testing boundaries.",
            "Do not exploit third-party data, perform destructive testing, mass scraping, social engineering, or access attempts outside accounts and environments you are authorized to test.",
          ],
        },
        {
          title: "Information not to send",
          body: [
            "Do not send master passwords, Recovery Keys, seed phrases, private keys, TOTP secrets, BYODB tokens, database passwords, CVV values, full backup files, or vault plaintext by email.",
            "If a screenshot is necessary, redact all secrets, personal email addresses, tokens, sensitive URLs, and third-party account information first.",
          ],
        },
      ],
      calloutTitle: "Do not send secrets",
      calloutText: `${CONTACT_EMAIL} is active for official correspondence, but data minimization still applies: send issue metadata, not vault secrets.`,
    },
    terms: {
      eyebrow: "Terms",
      title: "Ciphora Terms & Conditions",
      summary: "These terms govern access to and use of Ciphora, including user responsibilities for local vault data, accounts, recovery, backups, and BYODB providers.",
      updated: "Effective April 26, 2026",
      facts: [
        { label: "Acceptance", value: "By using the service" },
        { label: "Governing law", value: "Indonesia, where applicable" },
        { label: "Contact", value: CONTACT_EMAIL },
      ],
      sections: [
        {
          title: "Acceptance of terms",
          body: [
            "By accessing or using Ciphora, users represent that they have read, understood, and agreed to these Terms & Conditions.",
            "If a user does not agree, the user must stop using the service and may export encrypted backups or remove local browser data before stopping.",
          ],
        },
        {
          title: "Service definition",
          body: [
            "Ciphora is a local-first encrypted vault application. Core features include local vault item storage, generator, TOTP, encrypted backup export/import, optional account features, recovery gates, and optional sync with user-owned providers.",
            "Account and sync features do not change the core principle that vault plaintext, master passwords, root keys, and Recovery Keys are not intended to be stored by Ciphora servers.",
          ],
        },
        {
          title: "User responsibilities",
          body: [
            "Users are responsible for securing their devices, browsers, master passwords, Recovery Keys, encrypted backups, account email, sessions, and BYODB provider credentials.",
            "Users must ensure that every item stored or synced through Ciphora is data they are legally authorized to manage.",
          ],
        },
        {
          title: "Accounts, authentication, and recovery",
          body: [
            "Ciphora may provide account login, email verification, session management, password changes, Recovery Key setup, and email-backed recovery gates.",
            "Resetting account login is not the same as recovering a vault. If a user loses the master password, Recovery Key, encrypted backups, and provider access, vault data may become unrecoverable.",
          ],
        },
        {
          title: "BYODB sync and third-party providers",
          body: [
            "BYODB sync uses providers selected and controlled by the user. Availability, quota, billing, CORS, token security, provider rules, and third-party service changes are outside Ciphora's direct control.",
            "Users are responsible for limiting provider token scope and avoiding tokens that grant broader access than needed for sync.",
          ],
        },
        {
          title: "Prohibited use",
          body: [
            "Users must not use Ciphora for illegal activity, unauthorized access, unlawfully obtained credentials, infringement of third-party rights, or attempts to disrupt the service.",
            "Users must not perform unlawful reverse engineering, system exploitation, mass scraping, API abuse, or security testing beyond legally authorized boundaries.",
          ],
        },
        {
          title: "Availability and service changes",
          body: [
            "Ciphora may be changed, patched, limited, temporarily unavailable, or partially discontinued for security, maintenance, architectural, or compliance reasons.",
            "Users should maintain encrypted backups and Recovery Keys because Ciphora does not guarantee permanent availability of data stored locally in a user's browser.",
          ],
        },
        {
          title: "Disclaimers and limitation of liability",
          body: [
            "To the maximum extent permitted by applicable law, Ciphora is provided as-is and as-available, without a guarantee that the service is error-free, continuously available, or suitable for every user-specific requirement.",
            "Ciphora is not responsible for loss of access caused by lost master passwords, Recovery Keys, backups, browser storage deletion, compromised devices, provider misconfiguration, or third-party service failures.",
          ],
        },
        {
          title: "Governing law",
          body: [
            "Unless mandatory law in a user's jurisdiction requires otherwise, these Terms & Conditions are interpreted under the laws of the Republic of Indonesia.",
            "If any provision cannot be enforced, the remaining provisions remain effective to the extent permitted by law.",
          ],
        },
      ],
      calloutTitle: "Recovery is shared responsibility",
      calloutText: "Ciphora can provide technical security and recovery flows, but users remain the primary holders of keys, backups, and provider access.",
    },
    privacy: {
      eyebrow: "Privacy",
      title: "Ciphora Privacy Policy",
      summary: "This policy explains the categories of data Ciphora processes, why processing occurs, retention, user rights, and the important boundary that vault plaintext is not intended to be sent to Ciphora servers.",
      updated: "Effective April 26, 2026",
      facts: [
        { label: "Privacy contact", value: CONTACT_EMAIL },
        { label: "Vault plaintext", value: "Not stored server-side" },
        { label: "Sync profile", value: "Ciphertext" },
      ],
      sections: [
        {
          title: "Controller and privacy contact",
          body: [
            `Ciphora operates the service at ${APP_PUBLIC_URL}. For privacy questions, data requests, or objections to processing, contact ${CONTACT_EMAIL}.`,
            "Requests may require reasonable account ownership verification so account data is not disclosed to unauthorized parties.",
          ],
        },
        {
          title: "Categories of data processed",
          body: [
            "When users use an account, Ciphora may process protected email identifiers, email verification state, session/device metadata, limited audit events, recovery metadata, and encrypted root-key wrappers.",
            "When users enable account-backed sync profiles, Ciphora may store sync profile ciphertext, provider type, safe label hints, timestamps, and operational metadata needed to load, update, or disconnect the profile.",
            "Ciphora may also process limited technical data such as request time, endpoint, hashed rate-limit keys, and security information needed to prevent abuse.",
          ],
        },
        {
          title: "Data not stored as plaintext",
          body: [
            "Ciphora is not intended to receive or store master passwords, plaintext Recovery Keys, root keys, vault item passwords, plaintext TOTP secrets, private keys, seed phrases, CVV values, plaintext provider tokens, or vault plaintext.",
            "If users intentionally send secrets through support email or another channel, Ciphora may ask users to delete or rotate those secrets because support channels are not secret storage locations.",
          ],
        },
        {
          title: "Purposes and legal bases",
          body: [
            "Data is processed to provide accounts, authentication, sessions, email verification, recovery gates, encrypted sync profiles, service security, rate limiting, security audit records, user support, and compliance with applicable obligations.",
            "Legal bases may include performance of a user-requested service, legitimate interests in security and abuse prevention, consent where required, and compliance with applicable legal obligations.",
          ],
        },
        {
          title: "Local storage and BYODB",
          body: [
            "The local vault is stored in the user's browser as an encrypted envelope. Clearing browser storage may remove local access if the user has no encrypted backup, Recovery Key, or usable sync profile.",
            "BYODB providers live in the user's own account. Data sent to those providers is ciphertext or required sync metadata. The privacy and security policies of the selected provider apply to that provider's service.",
          ],
        },
        {
          title: "Service providers and transfers",
          body: [
            "Ciphora may use infrastructure and transactional email providers such as Cloudflare Pages/Functions, Cloudflare D1, Brevo, Resend, and Turso archive foundation to operate the service.",
            "Those providers may process operational data in their role as service providers. Processing locations may differ from the user's country depending on provider infrastructure.",
          ],
        },
        {
          title: "Retention",
          body: [
            "Account data is retained while the account is active or as needed for security, limited audit, dispute resolution, legal compliance, or abuse prevention.",
            "Temporary sessions and challenges are time-limited and may be revoked. Email verification and recovery tokens are designed to be short-lived and single-use where possible.",
            "Local browser data remains on the user's device until the user deletes it, resets local storage, changes browsers, or the browser removes storage.",
          ],
        },
        {
          title: "User rights",
          body: [
            "Depending on applicable law, users may request access, correction, deletion, restriction, portability, withdrawal of consent, or object to certain processing of personal data.",
            `Requests may be sent to ${CONTACT_EMAIL}. Ciphora will process valid requests when they can be verified and do not conflict with legal obligations, security needs, or third-party rights.`,
          ],
        },
        {
          title: "Children",
          body: [
            "Ciphora is not intended for children who do not have legal capacity to consent to digital service use under applicable law.",
            "If Ciphora becomes aware that an account was created without a valid consent basis, Ciphora may restrict or delete the account as appropriate.",
          ],
        },
        {
          title: "Policy changes",
          body: [
            "Ciphora may update this Privacy Policy to reflect service, security, legal, or operational changes.",
            "Material changes will be shown on this page or through another reasonable notice mechanism. Continued service use after changes take effect is treated as acceptance of the updated policy to the extent permitted by law.",
          ],
        },
      ],
      calloutTitle: "Privacy by design",
      calloutText: "Ciphora follows data minimization: the server handles account state, security, and selected ciphertext; vault plaintext remains under user control.",
    },
  },
};

const pageIcons: Record<PublicPageKind, typeof ShieldCheck> = {
  about: ShieldCheck,
  contact: EnvelopeSimple,
  terms: FileText,
  privacy: LockKey,
};

const pageNav: Array<{ page: PublicPageKind; path: string; labelKey: keyof typeof commonCopy.id }> = [
  { page: "about", path: ROUTE_PATHS.about, labelKey: "about" },
  { page: "contact", path: ROUTE_PATHS.contact, labelKey: "contact" },
  { page: "terms", path: ROUTE_PATHS.terms, labelKey: "terms" },
  { page: "privacy", path: ROUTE_PATHS.privacy, labelKey: "privacy" },
];

export default function PublicInfoPage({
  page,
  onOpenVault,
}: {
  page: PublicPageKind;
  onOpenVault: () => void;
}) {
  const { locale } = useI18n();
  const copy = commonCopy[locale];
  const content = pages[locale][page];
  const PageIcon = pageIcons[page];

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(to right, hsl(var(--grid-line)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--grid-line)) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to={ROUTE_PATHS.landing} className="flex min-w-0 items-center gap-2.5">
            <BrandLogo variant="wordmark" className="h-8 w-auto shrink-0" />
            <span className="hidden rounded-sm border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-amber-500 sm:inline">
              {APP_VERSION}
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label={copy.pageIndex}>
            {pageNav.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`rounded-sm px-3 py-1.5 font-mono text-xs transition-colors duration-150 ${
                  item.page === page
                    ? "bg-amber-500/10 text-amber-500"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {copy[item.labelKey]}
              </Link>
            ))}
          </nav>

          <button
            onClick={onOpenVault}
            className="flex items-center gap-2 rounded-sm bg-amber-500 px-4 py-2 font-mono text-xs font-bold text-neutral-950 transition-all duration-150 hover:bg-amber-400"
          >
            <span>{copy.openVault}</span>
            <ArrowRight weight="duotone" size={14} />
          </button>
        </div>
      </header>

      <main className="relative z-10 px-4 py-14 sm:px-6 sm:py-20">
        <section className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <div>
            <Link
              to={ROUTE_PATHS.landing}
              className="mb-8 inline-flex items-center gap-2 rounded-sm border border-border px-3 py-2 font-mono text-xs text-muted-foreground transition-colors duration-150 hover:border-amber-500/50 hover:text-foreground"
            >
              <ArrowLeft weight="duotone" size={14} />
              {copy.backHome}
            </Link>

            <div className="mb-5 inline-flex items-center gap-2 rounded-sm border border-amber-500/25 bg-amber-500/10 px-3 py-1.5">
              <PageIcon weight="duotone" size={14} className="text-amber-500" />
              <span className="font-mono text-xs tracking-wider text-amber-500">
                {content.eyebrow}
              </span>
            </div>

            <h1 className="font-heading text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl">
              {content.title}
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              {content.summary}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <span className="rounded-sm border border-border bg-card px-3 py-2 font-mono text-xs text-muted-foreground">
                {content.updated}
              </span>
              <span className="rounded-sm border border-border bg-card px-3 py-2 font-mono text-xs text-muted-foreground">
                {copy.version}: <span className="text-foreground">{APP_VERSION}</span>
              </span>
            </div>
          </div>

          <aside className="rounded-sm border border-border bg-card p-5 shadow-sm">
            <p className="mb-4 font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
              {copy.officialPage}
            </p>
            <div className="space-y-3">
              {content.facts.map((fact) => (
                <div key={fact.label} className="rounded-sm border border-border bg-background/60 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    {fact.label}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {fact.value}
                  </p>
                </div>
              ))}
              <div className="rounded-sm border border-border bg-background/60 p-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  {copy.publicUrl}
                </p>
                <a href={APP_PUBLIC_URL} className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-amber-500 hover:text-amber-400">
                  <Globe weight="duotone" size={15} />
                  {APP_PUBLIC_URL.replace("https://", "")}
                </a>
              </div>
              {page === "contact" && (
                <div className="rounded-sm border border-amber-500/25 bg-amber-500/10 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-500">
                    {copy.contactEmail}
                  </p>
                  <a href={`mailto:${CONTACT_EMAIL}`} className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-foreground hover:text-amber-500">
                    <EnvelopeSimple weight="duotone" size={15} />
                    {CONTACT_EMAIL}
                  </a>
                </div>
              )}
            </div>
          </aside>
        </section>

        <section className="mx-auto mt-12 grid max-w-6xl gap-4 lg:grid-cols-2">
          {content.sections.map((section) => (
            <article key={section.title} className="rounded-sm border border-border bg-card p-6">
              <h2 className="font-heading text-xl font-bold text-foreground">
                {section.title}
              </h2>
              <div className="mt-4 space-y-3">
                {section.body.map((paragraph) => (
                  <p key={paragraph} className="text-sm leading-relaxed text-muted-foreground">
                    {paragraph}
                  </p>
                ))}
              </div>
            </article>
          ))}
        </section>

        <section className="mx-auto mt-8 max-w-6xl rounded-sm border border-amber-500/30 bg-amber-500/10 p-5">
          <div className="flex gap-3">
            <WarningCircle weight="duotone" size={22} className="mt-0.5 shrink-0 text-amber-500" />
            <div>
              <h2 className="font-heading text-base font-bold text-foreground">
                {content.calloutTitle}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {content.calloutText}
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-border px-4 py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <BrandLogo variant="mark" className="h-6 w-6" />
            <span className="font-mono text-xs text-muted-foreground">
              {APP_NAME} {APP_VERSION}
            </span>
          </div>
          <p className="max-w-2xl font-mono text-xs text-muted-foreground sm:text-right">
            {copy.footer}
          </p>
        </div>
      </footer>
    </div>
  );
}
