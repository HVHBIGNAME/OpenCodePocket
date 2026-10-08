export type Attachment = { type: 'file'; mime: string; filename: string; url: string; bytes: number };
const maximumImageBytes = 1024 * 1024;
const maximumSourceBytes = 40 * 1024 * 1024;

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать вложение. Выберите файл повторно.'));
    reader.onabort = () => reject(new Error('Чтение вложения отменено.'));
    reader.readAsDataURL(blob);
  });
}

async function compressImage(file: File): Promise<Blob> {
  const source = URL.createObjectURL(file);
  const image = new Image();
  const canvas = document.createElement('canvas');
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Не удалось открыть фото. Выберите JPEG, PNG или WebP.'));
      image.src = source;
    });
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить фото для отправки.');
    const draw = () => {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    const encode = (quality: number) =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Не удалось обработать фото.'))),
          'image/jpeg',
          quality,
        );
      });
    draw();
    for (const quality of [0.85, 0.7, 0.55]) {
      const blob = await encode(quality);
      if (blob.size <= maximumImageBytes) return blob;
    }
    canvas.width = Math.max(1, Math.round(canvas.width / 2));
    canvas.height = Math.max(1, Math.round(canvas.height / 2));
    draw();
    return await encode(0.75);
  } finally {
    image.src = '';
    URL.revokeObjectURL(source);
    canvas.width = canvas.height = 0;
  }
}

export async function prepareAttachment(file: File): Promise<Attachment> {
  if (file.size > maximumSourceBytes) throw new Error('Исходный файл слишком большой (максимум 40 МБ).');
  let mime = file.type.toLowerCase();
  if (!mime) {
    const extension = file.name.split('.').pop()?.toLowerCase();
    mime =
      (
        {
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          webp: 'image/webp',
          heic: 'image/heic',
          heif: 'image/heif',
          pdf: 'application/pdf',
        } as Record<string, string>
      )[extension ?? ''] ?? '';
  }
  if (
    !['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'].includes(mime)
  )
    throw new Error('Поддерживаются фото JPEG, PNG, WebP, HEIC и документы PDF.');
  const compress =
    mime.startsWith('image/') &&
    (file.size > maximumImageBytes || mime === 'image/heic' || mime === 'image/heif');
  const blob = compress ? await compressImage(file) : file;
  if (blob.size > 8 * 1024 * 1024) throw new Error('Максимальный размер вложений после обработки — 8 МБ.');
  return {
    type: 'file',
    mime: compress ? 'image/jpeg' : mime,
    filename: compress ? `${file.name.replace(/\.[^.]+$/, '')}.jpg` : file.name,
    url: await dataUrl(blob),
    bytes: blob.size,
  };
}
