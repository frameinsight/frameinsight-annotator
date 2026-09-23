import {useState} from 'react';
import {ArrowLeft, ArrowRight, Check, Download, MousePointer2, ScanLine, Users, WandSparkles} from 'lucide-react';
import {Button} from './ui/button';

const steps = [
  {title: 'Start with one person', icon: Users, text: 'Choose New person, then draw a box around the part of that person you can see.', tip: 'Keep the same person selected while you move through the video.', action: 'New person', key: 'N'},
  {title: 'Move forward and adjust', icon: MousePointer2, text: 'Skip a few frames and move or resize the box. Interpolation fills the frames between your corrections.', tip: 'Go back and check the in-between frames. Drag any box that needs a correction.', action: 'Next frame', key: 'F'},
  {title: 'Keep one ID for both boxes', icon: ScanLine, text: 'Use Visible for what you can see. If you also need the estimated full body, copy Visible to Extended, then resize the Extended box.', tip: 'The second box belongs to the same person. You do not need New person again.', action: 'ID, class & color', key: 'I'},
  {title: 'Remove boxes during hiding', icon: WandSparkles, text: 'When the person is hidden, select the box type and delete its boxes for that frame range.', tip: 'Deleted ranges stop interpolation. To fill a range again, choose Restore deleted range, then Fill between my boxes.', action: 'Delete boxes in range', key: 'Shift + Delete'},
  {title: 'Save, review and share', icon: Download, text: 'Your edits save automatically. Check the frames between corrections, then download your annotations when you are ready.', tip: 'An annotation download contains boxes and IDs. Keep the original video separately.', action: 'Save', key: 'Ctrl + S'},
];

export function Onboarding({onDone}: {onDone: () => void}) {
  const [step, setStep] = useState(0);
  const item = steps[step];
  const Icon = item.icon;
  return (
    <div className="onboarding">
      <div className="guide-progress" aria-label={`Step ${step + 1} of ${steps.length}`}>
        {steps.map((entry, index) => <button key={entry.title} type="button" aria-label={`Step ${index + 1}: ${entry.title}`} aria-current={index === step ? 'step' : undefined} onClick={() => setStep(index)}><span>{index < step ? <Check size={13}/> : index + 1}</span></button>)}
      </div>
      <div className="guide-content" aria-live="polite" aria-atomic="true">
        <div className="guide-icon"><Icon size={27}/></div>
        <span className="guide-eyebrow">STEP {step + 1} OF {steps.length}</span>
        <h3>{item.title}</h3>
        <p>{item.text}</p>
        <div className="guide-tip">{item.tip}</div>
        <div className="guide-shortcut"><span>{item.action}</span><kbd>{item.key}</kbd></div>
      </div>
      <div className="guide-actions">
        <Button variant="ghost" onClick={step ? () => setStep(step - 1) : onDone}>{step ? <><ArrowLeft size={15}/>Back</> : 'Close guide'}</Button>
        <Button onClick={step === steps.length - 1 ? onDone : () => setStep(step + 1)}>{step === steps.length - 1 ? <>Ready to annotate<Check size={15}/></> : <>Next<ArrowRight size={15}/></>}</Button>
      </div>
      <p className="guide-footnote">You can reopen this guide any time. Every shortcut also has a button.</p>
    </div>
  );
}
