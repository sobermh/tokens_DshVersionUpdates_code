/** Resolve plugin-owned copy from the public desktop locale; unknown locales use English. */
export function updateMessages(locale) {
  const zh = typeof locale === 'string' && /^zh(?:-|$)/iu.test(locale)
  return zh ? {
    check: '检查更新…', checking: '正在检查更新…', download: '下载', later: '稍后', ok: '确定',
    unavailableTitle: '无法检查更新', unavailable: name => `${name} 无法检查更新。`, retry: '请稍后重试。',
    availableTitle: name => `${name} 有可用更新`, available: (name, version) => `${name} ${version} 已发布。`,
    manual: '此构建无法自动安装更新，请手动下载：',
    currentTitle: name => `${name} 已是最新版本`, current: name => `${name} 暂无更新版本。`,
    installed: version => `已安装版本：${version}`, confirm: '现在下载此更新吗？',
    readyTitle: name => `${name} 更新已下载`, ready: (name, version) => `${name} ${version} 可以安装了。`,
    macReady: name => `磁盘映像已打开。请替换“应用程序”中的 ${name}，然后重新启动。`,
    winReady: name => `安装程序已启动。请按提示更新 ${name}。`,
    trayAvailable: (name, version) => `${name} ${version} 有可用更新`,
    trayDownloading: (name, version) => `正在下载 ${name} ${version}…`,
  } : {
    check: 'Check Updates…', checking: 'Checking for Updates…', download: 'Download', later: 'Later', ok: 'OK',
    unavailableTitle: 'Unable to Check for Updates', unavailable: name => `${name} could not check for updates.`, retry: 'Please try again later.',
    availableTitle: name => `${name} Update Available`, available: (name, version) => `${name} ${version} is available.`,
    manual: 'This build cannot install updates automatically. Download it manually:',
    currentTitle: name => `${name} Is Up to Date`, current: name => `No newer version of ${name} is available.`,
    installed: version => `Installed version: ${version}`, confirm: 'Download this update now?',
    readyTitle: name => `${name} Update Downloaded`, ready: (name, version) => `${name} ${version} is ready to install.`,
    macReady: name => `The disk image has opened. Replace ${name} in Applications, then reopen it.`,
    winReady: name => `The installer has started. Follow it to update ${name}.`,
    trayAvailable: (name, version) => `${name} ${version} Available`,
    trayDownloading: (name, version) => `Downloading ${name} ${version}…`,
  }
}
