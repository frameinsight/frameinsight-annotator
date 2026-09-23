import {useState} from 'react';
import {ArrowLeft, ArrowRight, Check, Download, FolderOpen, MousePointer2, ScanLine, Users, WandSparkles} from 'lucide-react';
import {Button} from './ui/button';

const steps = [
  {title:'Create a project and add videos',icon:FolderOpen,text:'Choose New project, give it a name and enter its classes. Open the project and choose New video to upload a recording or enter its local path.',tip:'Use Import annotations in the editor if you already have YOLO or MOT labels. Preview them before adding.',action:'Open the project library',key:'Home'},
  {title: 'Start with one object', icon: Users, text: 'Choose New track, select a class, then draw a box around your object.', tip: 'Keep the same track selected as you move through the video. Each object has one ID.', action: 'New track', key: 'N'},
  {title: 'Move forward and adjust', icon: MousePointer2, text: 'Skip a few frames and move or resize the box. Interpolation is always on and fills the frames between your corrections.', tip: 'Go back and check the in-between frames. Background dimming keeps the selected track’s boxes bright while you work.', action: 'Next frame', key: 'F'},
  {title: 'Add classes to the same ID', icon: ScanLine, text: 'Choose another class and draw its box. Or open Copy to class…, choose Source class and Target class, then click Copy boxes and resize the copies.', tip: 'Use Project settings to rename classes everywhere, even before export. IDs and box positions stay the same.', action: 'ID, class & color', key: 'I'},
  {title: 'Delete or restore a range', icon: WandSparkles, text: 'When a box should be absent, choose its class and delete the boxes for that frame range.', tip: 'Deleted ranges pause interpolation. Choose Restore range to fill them between your boxes or recover their original coordinates.', action: 'Delete boxes in range', key: 'Shift + Delete'},
  {title: 'Review, validate and export', icon: Download, text: 'Choose Finish → Review in editor to check playback at 0.125×, 0.25×, 0.5× or 1×. Then Finish → I reviewed — continue opens the Validate & export page.', tip: 'Run annotation validation, then download JSON after a pass. No video rendering is needed. Name changes only need revalidation.', action: 'Save', key: 'Ctrl + S'},
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
