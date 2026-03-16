// @ts-nocheck
import { useDesktopShellStore } from '../store/useDesktopShellStore';

export function registerSetupStoreActions(deps) {
  const {
    t,
    getSkillsDirs,
    setSkillsDirs,
    addSkillDir,
    installDefaultSkills,
    handleKernelInstall,
    saveConfigAndEnter
  } = deps;

  useDesktopShellStore.getState().setSetupActions({
    removeSkillDir: (dirPath) => {
      const target = String(dirPath || '').trim();
      if (!target) {
        return;
      }
      const nextSkillsDirs = getSkillsDirs().filter((item) => String(item || '').trim() !== target);
      setSkillsDirs(nextSkillsDirs);
    },
    addSkillDir: async () => {
      await addSkillDir();
    },
    installDefaultSkills: async () => {
      await installDefaultSkills();
    },
    installKernel: async () => {
      await handleKernelInstall(t('btn.installKernel'));
    },
    saveAndEnter: async () => {
      await saveConfigAndEnter();
    }
  });
}

export function registerMainStoreActions(deps) {
  const {
    t,
    openOpenClawWeb,
    reconfigureFromSavedConfig,
    runDoctor,
    handleKernelInstall,
    openFirstSkillDir,
    saveSummaryCustomApiMode
  } = deps;

  useDesktopShellStore.getState().setMainActions({
    openWeb: async () => {
      await openOpenClawWeb();
    },
    reconfigure: async () => {
      await reconfigureFromSavedConfig();
    },
    runDoctor: async () => {
      await runDoctor();
    },
    updateKernel: async () => {
      useDesktopShellStore.getState().setSummary({
        doctorOutput: t('msg.updatingKernel')
      });
      await handleKernelInstall(t('btn.updateKernel'));
    },
    openFirstSkillDir: async () => {
      await openFirstSkillDir();
    },
    saveSummaryCustomApiMode: async (mode) => {
      await saveSummaryCustomApiMode(mode);
    }
  });
}
