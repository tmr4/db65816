/* eslint-disable eqeqeq */

//import * as vscode from 'vscode';
//import * as vscode from '@vscode/debugadapter';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

//import { RuntimeVariable, IRegisters65816 } from './da65xx'

import { MPU65816 } from './mpu65816';
import { ObsMemory } from './obsmemory';
import { Interrupts } from './interrupts';
import { terminalStart, terminalDispose, terminalWrite } from './terminal';
import { Debug65xxSession } from './da65xx';

export interface IRuntimeBreakpoint {
    id: number;
    line: number;
    address: number;
    verified: boolean;
}

interface IRuntimeStackFrame {
    index: number;
    name: string;
    file: string;
    line: number;
    column: number;
    instruction: number;
//    instructionPointerReference?: string;
}

interface IRuntimeStack {
    count: number;
    frames: IRuntimeStackFrame[];
}

interface IPosition {
    line: number;
    address: number;
    opcode: number;
    instruction: string;
}

var buf = Buffer.alloc(0);

// when characters are written to the putc address they will be stored in a buffer
// and flushed to the console upon receipt of a CR
function putc(value: number): void {
    // gather putc characters until EOL
    if(value === 0xd) {     // is CR
        console.log(buf.toString());   // console log will add the CR
        buf = Buffer.alloc(0);           // clear buffer for next time
    }
    else {
        var buf1 = Buffer.from(String.fromCharCode(value));
        var bufarray = [buf, buf1];

        // add character to buffer
//        buf = buf + String.fromCharCode(value);
        buf = Buffer.concat(bufarray);
    }
}

function getc(value: number): void {
}

/**
 * EE65xx is a 65xx execution engine with debugging support:
 * it "executes" a 65xx binary and sends events to the debug adapter informing it
 * of key debugging events.  The debug adapter "follows along" with a CA65 listing
 * file (*.lst), simulating "running" through the source code line-by-line.  EE65xx
 * exposes several methods allowing the debug adapter to control the simulation.
 * EE65xx supports typical stepping and breakpoint functionality as the core of the
 * "debugging support".  
 * EE65xx is completely independent from VS Code and the 
 * Debug Adapter and can be run as a standalone simulator without debugging.
 */
export class EE65xx extends EventEmitter {

    private continueID!: NodeJS.Timeout;
    private isBreak: boolean = false;
    private isDebug: boolean = true;
    private da65xx: Debug65xxSession;

//    private filename: string = '';

    dbInt!: Interrupts;
//    aciaAddr!: number;
//    viaAddr!: number;

    public mpu!: MPU65816;

    public constructor(da65xx: Debug65xxSession) {
        super();

        //this.getcAddr = getcAddr;
        //this.putcAddr = putcAddr;
        this.da65xx = da65xx;
    }

    //private getcAddr: number;
    //private putcAddr: number;
    public obsMemory!: ObsMemory;
    
    // Start executing the given program
    public start(bsource: string = '', fsource: string = '', aciaAddr: number | undefined, viaAddr: number | undefined, stopOnEntry: boolean = true, debug: boolean = true): void {

        terminalStart('65816 Debug', viaAddr ? true : false); // start debug terminal if not already started

        this.loadBinary(bsource);

        this.mpu = new MPU65816(this.obsMemory.obsMemory);
        if (viaAddr) {
            //this.viaAddr = viaAddr;
            if (!this.dbInt) {
                this.dbInt = new Interrupts(this, this.mpu);
            }
            this.dbInt.addVIA(viaAddr, this.obsMemory);
        } else {
            //this.obsMemory.subscribeToWrite(this.getcAddr, getc); // = 0xf004
        }

        if(aciaAddr) {
            //this.aciaAddr = aciaAddr;
            if(!this.dbInt) {
                this.dbInt = new Interrupts(this, this.mpu);
            }
            this.dbInt.addACIA(aciaAddr, fsource, this.obsMemory);
        } else {
            this.obsMemory.subscribeToWrite(0xf001, (value: number): void => {
                terminalWrite(String.fromCharCode(value));
            });
        }

        // *** TODO: continue doesn't make any sense here we need something similar to loop in childp ***
        if (debug) {
            if(!stopOnEntry) {
                this.continue();
            }
            else {
                this.sendEvent('stopOnEntry');
            }
        } else {
            this.continue();
        }
    }

    // *** TODO: terminal isn't disposed when debugging is stopped ***
    public end() {
        terminalDispose();
        this.sendEvent('exited');
    }

    // Continue execution to address or until we hit a breakpoint
    // Returns false on hitting a breakpoint, otherwise returns true
    public stepTo(address: number) {

        // take a single step to get over a breakpoint
        this.step(false);

        while (address !== (this.mpu.pc + (this.mpu.pbr << 16))) {
            if (this.da65xx.checkBP()) {
//                this.sendEvent('stopOnBreakpoint');
                return;
            }
            this.step(false);
        }
        this.sendEvent('stopOnStep');
    }

    // Returns a stacktrace for the current line
//    public stack(): IRuntimeStack {
//
//        const frames: IRuntimeStackFrame[] = [];
//        const stackFrame: IRuntimeStackFrame = {
//            index: 1,
////            name: pl.instruction,                    // routine label
//            name: '',
//            file: this.filename,
////            line: this.currentLine,
//            line: 0,
//            column: 0, // words[i].index
//            instruction: this.mpu.pc
//        };
//
//        frames.push(stackFrame);
//
//        return {
//            frames: frames,
//            count: 1
//        };
//    }

    // load binary and initialize memory as observable
    private loadBinary(file: string): void {
        this.obsMemory = new ObsMemory(fs.readFileSync(file));
    }

//  ; Direct page(DP) defines:
//      x = sforth instance # 0-4
//      DPx:  direct page start
//      DP0 = __DP0_START__
//  
//      ; Offsets into the direct page applicable to each Forth instance
//      ; SPo:  Top of hardware return stack
//      ; FSPo: Top of Forth data stack
//      ; RSPo: Top of Forth return stack
//      ; *** TODO: these need tuned.We don't need that much return stack.
//      ;       Maybe a space for a future control or floating point stack ? ***
//  SPo   = __DP0_SIZE__ - 1
//  FSPo = __DP0_SIZE__ / 3 * 2
//  RSPo = __DP0_SIZE__ / 3
//  FPSPo = __DP0_SIZE__ / 3 - $800

    // Execute the current line.
    // Returns true if execution sent out a stopped event and needs to stop.
	public step(stopOnStep: boolean): boolean {
//        let mpu = this.mpu;

        if (this.dbInt && this.dbInt.enabled) {
            this.dbInt.trip();
        }
        this.mpu.step();

        if (stopOnStep) {
            this.sendEvent('stopOnStep');
        }

        // continue
        return false;
    }

    public pause() {
        clearInterval(this.continueID);
        this.isBreak = true;     // force step loop to exit
        this.sendEvent('stopOnPause');
        this.isBreak = false;
    }

    // continue execution of source code
    public continue() {
        // run at 10 ms intervals to avoid blocking
        this.continueID = setInterval(() => { this.run(); }, 10);
    }

    // run source code for a given number of steps
    private run() {
        let count = 0;
        // Take 100000 steps every interval except when we're waiting for input.
        // Reduce steps when we're waiting for input to avoid CPU churn.
        // We're in the next_keyboard_buffer_char loop (about 16 steps) when
        // we're waiting for input.  These values seem to give good performance/idle cpu.
        let steps = this.mpu.waiting ? 20 : 100000;

        // take a single step to get over a breakpoint
        this.step(false);

        while (count++ < steps && !this.isBreak) {
            if (this.isDebug && this.da65xx.checkBP()) {
                clearInterval(this.continueID);
                this.isBreak = true;     // force step loop to exit
                // send 'stopped' event
                //                console.log('Hit breakpoint at: ' + bps[0].address);
//                this.sendEvent('stopOnBreakpoint');
                break;
            } else if (this.mpu.waiting && (steps === 100000)) {
                // reduce steps if we've shifted to waiting during run loop
                // this should further reduce churn but at the cost of responsiveness
                // *** TODO: evaluate and tune these if necessary ***
                steps = 1000; // 20 causes long startup
            }
            this.step(false);
        }
        count = 0;
        this.isBreak = false;
    }

    public sendEvent(event: string, ...args: any[]): void {
        setTimeout(() => {
            this.emit(event, ...args);
        }, 0);
    }

    public getVariable(name: string, address: number) {

    }

//    public readMemory(address: number, length: number): RuntimeVariable[] {
//        let rv: RuntimeVariable[] = [];
//        let end = address + length;
//
//        for (let i = address; i < end; i++) {
//            rv.push(new RuntimeVariable(`global_${i}`, i));
//        }
//        return rv;
//    }
    public readMemory(address: number, length: number): Uint8Array {
        return this.obsMemory.memory.slice(address,address+length);
    }
}

// registered listener
// from: https://stackoverflow.com/questions/1759987/listening-for-variable-changes-in-javascript
// 
// let x = {
//   aInternal: 10,
//   aListener: function(val: any) {},
//   set a(val) {
//     this.aInternal = val;
//     this.aListener(val);
//   },
//   get a() {
//     return this.aInternal;
//   },
//   registerListener: function(listener: any) {
//     this.aListener = listener;
//   }
// };
// 
// x.registerListener(function(val: any) {
//   console.log(String.fromCharCode(val));
// });
// 
// x.a = 0x65;

