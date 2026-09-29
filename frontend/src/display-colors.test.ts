import {it,expect} from 'vitest';
import {annotationColor} from './display-colors';
import type {Identity,Project} from './types';
it('uses the project palette for every class despite saved per-track style overrides',()=>{
 const person={id:'one',name:'Track 1',person_id:1,color:'#a3e635',box_styles:{'class:Visible':{class_name:'Visible',color:'#a3e635'},person_ext:{class_name:'Extended',color:'#c084fc'}}} as Identity;
 const project={class_colors:{Visible:'#38bdf8',Extended:'#facc15'},state:{identities:{one:person}}} as unknown as Project;
 const before=structuredClone(project);
 expect(annotationColor(project,person,'class:Visible','class')).toBe('#38bdf8');
 expect(annotationColor(project,person,'person_ext','class')).toBe('#facc15');
 expect(annotationColor(project,person,'class:Visible','track')).toBe('#a3e635');
 expect(annotationColor(project,person,'person_ext','track')).toBe('#a3e635');
 expect(project).toEqual(before);
});
it('uses the same catalog fallback across tracks in older projects without class colors',()=>{
 const one={id:'one',name:'Track 1',person_id:1,box_styles:{'class:Hat':{class_name:'Hat',color:'#38bdf8'}}} as Identity;
 const two={id:'two',name:'Track 2',person_id:2,box_styles:{'class:Hat':{class_name:'Hat',color:'#facc15'}}} as Identity;
 const project={state:{identities:{one,two}}} as unknown as Project;
 expect(annotationColor(project,one,'class:Hat','class')).toBe(annotationColor(project,two,'class:Hat','class'));
 expect(annotationColor(project,one,'class:Hat','track')).not.toBe(annotationColor(project,two,'class:Hat','track'));
});
