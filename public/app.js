const form = document.querySelector('#test-form');
const input = document.querySelector('#stream-url');
const submitButton = document.querySelector('#submit-button');
const formError = document.querySelector('#form-error');
const panel = document.querySelector('#test-panel');
const title = document.querySelector('#panel-title');
const statusLabel = document.querySelector('#status-label');
const progressMessage = document.querySelector('#progress-message');
const elapsedTime = document.querySelector('#elapsed-time');
const progressBar = document.querySelector('#progress-bar');
const resultCard = document.querySelector('#result-card');
const resultIcon = document.querySelector('.result-icon');
const resultTitle = document.querySelector('#result-title');
const resultMessage = document.querySelector('#result-message');
const resolutionCard = document.querySelector('#resolution-card');
const currentResolution = document.querySelector('#current-resolution');
const currentFps = document.querySelector('#current-fps');
const availableQualities = document.querySelector('#available-qualities');
const codecCard = document.querySelector('#codec-card');
const codecSummary = document.querySelector('#codec-summary');
const videoCodec = document.querySelector('#video-codec');
const videoCodecId = document.querySelector('#video-codec-id');
const audioCodec = document.querySelector('#audio-codec');
const audioCodecId = document.querySelector('#audio-codec-id');
const codecQualityNote = document.querySelector('#codec-quality-note');
const stallCard = document.querySelector('#stall-card');
const stallSummary = document.querySelector('#stall-summary');
const stallCount = document.querySelector('#stall-count');
const stallDuration = document.querySelector('#stall-duration');
const stallObservation = document.querySelector('#stall-observation');
const stallErrorMargin = document.querySelector('#stall-error-margin');
const audioCard = document.querySelector('#audio-card');
const audioSummary = document.querySelector('#audio-summary');
const audioLevel = document.querySelector('#audio-level');
const audioStatus = document.querySelector('#audio-status');
const audioObservation = document.querySelector('#audio-observation');
const audioCoverage = document.querySelector('#audio-coverage');
const localizedNumberFormatter = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function formatSeconds(milliseconds) {
  if (!Number.isFinite(milliseconds)) return 'Bilgi alınamadı';
  return `${localizedNumberFormatter.format(Math.max(0, milliseconds) / 1000)} sn`;
}

const statusCopy = {
  queued: ['Kuyrukta', 'Test ortamı hazırlanıyor…'],
  starting: ['Başlıyor', 'Twitch oynatıcısı açılıyor…'],
  running: ['Test ediliyor', 'Yayın 30 saniye gözlemleniyor…'],
  online: ['Yayın açık', 'Yayın test ortamında oynatılıyor…'],
  offline: ['Yayın çevrimdışı', 'Kanal test sırasında çevrimdışı göründü.'],
  unavailable: ['Test tamamlanamadı', 'Oynatma verisi alınamadı.'],
};

function showError(message) {
  formError.textContent = message;
  formError.hidden = false;
}

function updateJob(job) {
  panel.dataset.state = job.result?.state || job.state;
  const [label, message] = statusCopy[job.result?.state] || statusCopy[job.state] || statusCopy.running;
  statusLabel.textContent = label;
  progressMessage.textContent = message;
  const seconds = Math.min(30, Math.round(job.state === 'complete' ? job.result?.observedSeconds || 0 : job.elapsedSeconds || 0));
  elapsedTime.textContent = `${seconds} / 30 sn`;
  progressBar.style.width = `${Math.min(100, seconds / 30 * 100)}%`;

  if (job.state === 'complete') {
    const state = job.result?.state;
    const resolution = job.result?.resolution;
    const codecs = job.result?.codecs;
    const stalls = job.result?.stalls;
    const audio = job.result?.audio;
    const observedSeconds = Number.isFinite(job.result?.observedSeconds) ? job.result.observedSeconds : 0;
    const complete = state === 'online';
    const partial = state === 'unavailable' && observedSeconds > 0;
    const offlineAfterStart = state === 'offline' && observedSeconds > 0;
    progressMessage.textContent = state === 'offline'
      ? offlineAfterStart
        ? `Yayın ${observedSeconds} saniye gözlendikten sonra çevrimdışı oldu; kısmi bulgular aşağıda.`
        : 'Kanal test başlamadan önce çevrimdışıydı.'
      : state === 'unavailable'
        ? partial
          ? `Test ${observedSeconds} saniyede kesildi; sonuçlar kısmi.`
          : (job.result?.completionMessage || 'Oynatma verisi alınamadı.')
        : `${observedSeconds} saniyelik gözlem tamamlandı.`;
    title.textContent = complete ? 'Test tamamlandı' : partial ? 'Kısmi test sonucu' : 'Test sonucu';
    resultTitle.textContent = complete
      ? 'Yayın test ortamında açıldı'
      : offlineAfterStart
        ? 'Yayın test sırasında çevrimdışı oldu'
        : state === 'offline'
          ? 'Yayın çevrimdışı'
          : partial ? 'Test kısmen tamamlandı' : 'Test tamamlanamadı';
    resultMessage.textContent = complete
      ? `${job.platform === 'kick' ? 'Kick' : 'Twitch'} / ${job.channel} yayını yaklaşık ${observedSeconds} saniye gözlemlendi. Bu sonuç yalnızca test süresini kapsar.`
      : offlineAfterStart
        ? `${job.channel} yayını ${observedSeconds} saniye sonra çevrimdışı oldu. O ana kadar elde edilen bulgular aşağıda.`
        : state === 'offline'
          ? `${job.channel} kanalı test başlamadan önce çevrimdışıydı.`
          : partial
            ? `${job.channel} için ${observedSeconds} saniyelik kısmi gözlem yapıldı. ${job.result?.completionMessage || 'Elde edilen bulgular aşağıda.'} Ölçülemeyen değerler “Bilgi alınamadı” olarak bırakıldı.`
            : (job.result?.completionMessage || 'Bu testte oynatma verisi elde edilemedi. Biraz sonra yeniden deneyebilirsin.');
    resultCard.dataset.state = state || 'unavailable';
    resultIcon.textContent = complete ? '✓' : state === 'offline' || partial ? '!' : '×';
    resultCard.hidden = false;
    resolutionCard.hidden = false;
    currentResolution.textContent = resolution?.current || 'Bilgi alınamadı';
    currentFps.textContent = Number.isFinite(resolution?.fps) ? `${Math.round(resolution.fps)} FPS` : 'Bilgi alınamadı';
    const qualities = Array.isArray(resolution?.available) ? [...new Set(resolution.available)] : [];
    availableQualities.textContent = qualities.length ? qualities.join(', ') : 'Seçenek bilgisi alınamadı';
    codecCard.hidden = false;
    videoCodec.textContent = codecs?.video?.label || 'Bilgi alınamadı';
    videoCodecId.textContent = codecs?.video?.identifier || '';
    audioCodec.textContent = codecs?.audio?.label || 'Bilgi alınamadı';
    audioCodecId.textContent = codecs?.audio?.identifier || '';
    codecQualityNote.textContent = codecs?.qualityExpectation || 'Ses codec bilgisi alınamadığı için kalite beklentisi çıkarılamadı.';
    codecSummary.hidden = Boolean(codecs?.video || codecs?.audio);
    codecSummary.textContent = 'Codec bilgisi alınamadı.';
    stallCard.hidden = false;
    stallSummary.hidden = Boolean(stalls);
    stallSummary.textContent = 'Takılma ölçümü alınamadı.';
    stallCount.textContent = Number.isFinite(stalls?.count) ? String(stalls.count) : 'Bilgi alınamadı';
    stallDuration.textContent = formatSeconds(stalls?.totalMilliseconds);
    stallObservation.textContent = formatSeconds(stalls?.observationMilliseconds);
    stallErrorMargin.textContent = Number.isFinite(stalls?.errorMarginMilliseconds)
      ? `±${formatSeconds(stalls.errorMarginMilliseconds)}`
      : 'Doğrulanmadı';
    audioCard.hidden = false;
    const audioStatusLabels = {
      signal: 'Sinyal var',
      'very-low': 'Çok düşük sinyal',
      'no-signal': 'Sinyal algılanmadı',
      unavailable: 'Ölçüm alınamadı',
    };
    audioStatus.textContent = audioStatusLabels[audio?.status] || 'Ölçüm alınamadı';
    audioLevel.textContent = Number.isFinite(audio?.levelDbfs)
      ? `${localizedNumberFormatter.format(audio.levelDbfs)} dBFS`
      : audio?.status === 'no-signal'
        ? `< ${localizedNumberFormatter.format(audio.measurementFloorDbfs || -90)} dBFS`
        : 'Bilgi alınamadı';
    audioObservation.textContent = formatSeconds(audio?.observationMilliseconds);
    audioCoverage.textContent = Number.isFinite(audio?.coveragePercent)
      ? `%${localizedNumberFormatter.format(audio.coveragePercent)}`
      : 'Bilgi alınamadı';
    audioSummary.hidden = audio?.status !== 'unavailable';
    audioSummary.textContent = 'Oynatıcı ses örneklerine erişim sağlamadı veya ölçüm kapsaması yetersizdi.';
    progressBar.style.width = complete ? '100%' : `${Math.min(100, observedSeconds / 30 * 100)}%`;
    submitButton.disabled = false;
    submitButton.querySelector('span:first-child').textContent = 'Yeniden test et';
  } else {
    title.textContent = `@${job.channel} test ediliyor`;
  }
}

async function pollJob(id) {
  while (true) {
    const response = await fetch(`/api/tests/${id}`, { cache: 'no-store' });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || 'Test durumu alınamadı.');
    updateJob(job);
    if (job.state === 'complete') return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.hidden = true;
  resultCard.hidden = true;
  resolutionCard.hidden = true;
  codecCard.hidden = true;
  stallCard.hidden = true;
  audioCard.hidden = true;
  panel.hidden = false;
  panel.dataset.state = 'queued';
  statusLabel.textContent = statusCopy.queued[0];
  progressMessage.textContent = statusCopy.queued[1];
  elapsedTime.textContent = '0 / 30 sn';
  progressBar.style.width = '0%';
  submitButton.disabled = true;
  submitButton.querySelector('span:first-child').textContent = 'Test başlıyor…';

  try {
    const response = await fetch('/api/tests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: input.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Test başlatılamadı.');
    await pollJob(result.id);
  } catch (error) {
    panel.hidden = true;
    showError(error.message || 'Bir sorun oluştu. Lütfen tekrar dene.');
    submitButton.disabled = false;
    submitButton.querySelector('span:first-child').textContent = 'Yayını test et';
  }
});

