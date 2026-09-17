import type {Binding} from './agent-world/behaviour-runtime';
export type WorldObservation={id:string;name:string;movable:boolean;mass:number;speed:number};
export type WorldViewer={
  manifest:{id:string;title:string;entities:{id:string;description?:string;bodyIds?:string[]}[];living?:{bindings:Binding[]}};
  save():Promise<unknown>;restore():Promise<void>;enter():Promise<void>;pause():boolean;reset():void;
  focusEntity(id:string):void;interact():string;inspect():WorldObservation|null;observe(id:string):WorldObservation|null;dispose():void;snapshot():unknown;
  behaviourState():{time:number;controls:Record<string,number>;quantities:Record<string,number>}|null;
  setBehaviourControl(id:string,value:number):void;
};
export function createWorldViewer(canvas:HTMLCanvasElement,manifestURL:string,onStatus?:(status:string)=>void):Promise<WorldViewer>;
