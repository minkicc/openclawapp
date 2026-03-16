import { TopBar } from './components/layout/TopBar';
import { MainView } from './components/main/MainView';
import { SetupView } from './components/setup/SetupView';
import { useLegacyBridge } from './hooks/useLegacyBridge';

export default function App() {
  useLegacyBridge();

  return (
    <>
      <div className="background" />
      <div className="shell">
        <TopBar />
        <main className="page-main">
          <SetupView />
          <MainView />
        </main>
      </div>
    </>
  );
}
