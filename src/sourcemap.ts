/* eslint-disable @typescript-eslint/naming-convention */
// python3 => Typescript
// Convert/combine cc65 individual relative object listing files to a full binary listing
// version 0.0.0
// February 15, 2022

/*
"""Convert/combine cc65 individual relative object listing files to a full binary listing

Usage: %s [options] <binary_filename>

Options) {
-h, --help      : Show this message
-m <filename>   : Set map file to <file>. Default "<bin_file root>.map".
-c              : Strip comments and most non-code lines from listing
-n              : Add a newline separator after jump and return instructions

Translates the relative addresses in the listing files produced by ca65 to absolute
addresses and combines these to produce a complete listing of the desired binary as
"listing.lst".  If a map file is not specified using the -m option, a map file with
a filename root the same as the binary file and an extension of ".map" must exist.
A listing file for each object module, <object>.o, specified in the map file must
exist and be named <object>.lst.
"""
*/

import * as fs from 'fs';
import { TextEncoder, TextDecoder } from 'node:util';
import * as path from 'path';

interface IModule {
    name: string;
    segments: ISegment[];
}

interface ISegment {
    name: string;
    start: number;
}

interface ISegFile {
    name: string;
    file: string[];
}

interface IDefualtSegment {
    directive: string;
    name: string;
}

interface IModStart {
    segment: string
    segFile: string[]
    segBase: number
    segOffset: number
}

interface IGetSeg {
    segFile: string[]
    segBase: number
}

export interface ISourceMap {
    address: number;
    module: string;
    opcode: number;
    instruction: string;
    sourceLine: number;
    source: string;
    listingLine: number;
    listing: string;
}

// *** TODO: consider adding source
// this isn't available from VICE symbol file
// but may be useful for identical symbols in
// different source files ***
interface ISymbol {
    address: number;
    size: number;       // size in bytes
    source: string;
}

export class SourceMap {
    private basename: string;

    private symbolMap = new Map<string, ISymbol>(); // symbol/address pair
    private sourceMap = new Map<number, ISourceMap>(); // binary address/source mapping
    private reverseMap = new Map<string, Map<number, number>>(); // source line #/binnary address mapping

    private default_segments: IDefualtSegment[] = [
        { directive: ".bss", name: "BSS" },
        { directive: ".code", name: "CODE" },
        { directive: ".data", name: "DATA" },
        { directive: ".rodata", name: "RODATA" },
        { directive: ".zeropage", name: "ZEROPAGE" }];

    private modules: IModule[] = [];     // records map file modules and their associated segment/offset pairs
    private segments: ISegment[] = [];   // recodes map file segments and their associated start address
    private segFiles: ISegFile[] = [];   // stores temp file object for each segment
    //var sourceMap = new Map<number, ISourceMap>();  // source map

    public constructor(dir: string, basename: string) {
        this.basename = basename;

        this.createSymbolMap(path.join(dir, basename + '.sym'));
        this.createSourceMap(dir, basename);
        this.createReverseMap();
    }

    // returns the source map associated with this address
    public get(address: number): ISourceMap | undefined {
        return this.sourceMap.get(address);
    }

    // Return address associate with the source/line pair
    // (returns undefined if not a valid instruction)
    public getRev(source: string, line: number): number | undefined {
        let address;
        let moduleMap = this.reverseMap.get(path.basename(source, '.s'));

        if (moduleMap) {
            address = moduleMap.get(line);
        }

        return address;
    }

    public getSymbol(symbol: string): ISymbol | undefined {
        return this.symbolMap.get(symbol);
    }

    public getSymbolAddress(symbol: string): number | undefined {
        return this.symbolMap.get(symbol)?.address;
    }

    public getModules() {
        return this.modules.flatMap(module => module.name);
    }

    // create symbol map from ld65 symbol table
    // typical ld65 VICE symbol table entry:
    // al 00F40A .KEYBOARD_BUFFER
    private createSymbolMap(file: string): void {
        // read map file and parse it into lines
        let m = fs.readFileSync(file);
        let lines = new TextDecoder().decode(m).split(/\r?\n/);

        // regular expression to parse this into address/symbol pair
        let reg0 = /(?:^al\s)([a-fA-F0-9]{6})(?:\s\.)(.*)/;

        for (let n = 0; n < lines.length; n++) {
            let line = lines[n];

            let match: RegExpExecArray | null;
            match = reg0.exec(line);
            if (match) {
                // save symbol
                // don't bother with local symbols
                if (!match[2].startsWith('@')) {
                    this.symbolMap.set(match[2], { address: parseInt(match[1], 16), size: 1, source: '' });
                }
            }
        }
    }

    // populate modules and segments from map_file
    private parse_map(map_file: string): void {
        // read map file and parse it into lines
        let m = fs.readFileSync(map_file);
        let lines = new TextDecoder().decode(m).split(/\r?\n/);

        let processing = '';
        let module_name = '';
        let module_segments: ISegment[] = [];
        let segs: string[] = [];   // temp segments

        // loop through map file capturing:
        //  1) modules and their associated segments/offsets
        //  2) segments and their associated starting address
        for (let n = 0; n < lines.length; n++) {
            let line = lines[n];

            if (processing === '') {
                let parse = line.split(' ');

                if (parse.length > 0) {
                    if (parse[0] === "Modules" && parse[1] === "list:") {
                        processing = "Modules";
                    }
                    else if (parse[0] === "Segment" && parse[1] === "list:") {
                        processing = "Segments";
                    }
                }
            }

            // capture segment/offset pairs in a module area
            if (processing === "Module") {
                if (line === '') {
                    // we're done parsing modules area
                    this.modules.push({ name: module_name, segments: module_segments });
                    processing = '';
                } else if (line[0] === " ") {
                    // a line with segment/offset pair
                    let seg = line.split(' ').filter(e => e !== '');
                    let offset = seg[1].split("=");
                    module_segments.push({ name: seg[0], start: parseInt(offset[1], 16) });

                    // note that segment is used if not included already
                    if (segs.filter(seg => seg === seg[0]).length === 0) {
                        segs.push(seg[0]);
                    }
                } else {
                    // a new module section
                    // save previous module's segment/offset pairs
                    // and get ready to process next module
                    this.modules.push({ name: module_name, segments: module_segments });
                    module_name = '';
                    module_segments = [];
                    processing = "Modules";
                }
            }

            // get name of next module
            if (processing === "Modules") {
                let pos = line.indexOf(".o:");
                if (pos >= 0) {
                    module_name = line.slice(0, pos);
                    processing = "Module";
                }
            }

            // capture all segments and their start addresses
            if (processing === "Segments") {
                if (line === '') {
                    processing = '';
                }
                else {
                    let seg = line.split(' ').filter(e => e !== '');
                    // ensure segment was listed in a module
                    if (segs.filter(s => s === seg[0]).length !== 0) {
                        // add segment/offset pair
                        this.segments.push({ name: seg[0], start: parseInt(seg[1], 16) });
                        this.segFiles.push({ name: seg[0], file: [] });
                    }
                }
            }
        }
    }

    private createSourceMap(dir: string, basename: string) {
        this.parse_map(path.join(dir, basename + '.map'));

        // Regular expressions used to parse portions of listing line) {
        // Isolate segment directive and it's segment label
        let reg0 = /\.segment \"{1}.*[^\"]"/;
        let reg1 = /([^"]*)/;

        // parse line into) {
        //   relative address
        //   assembler code
        //   source stripped of comment
        // parse_line = re.compile(
        //    r'^([A-F0-9]{6})'               // relative address
        //    r'(?:r\s\d\s*)'                 // file reference (not captured)
        //    r'((?:[0-9A-Frx]{2}\s){0,4})'    // assembler code
        //    r'(?:\s*)'                      // whitespace (not captured)
        //    r'([A-z0-9@]+[:]+)?'            // optional line label and colon (not captured)
        //    r'(?:\s*)'                      // whitespace (not captured)
        //    r'([^;]*)'                      // source stripped of comment

        let reg3 = /^([A-F0-9]{6})(?:r\s\d\s*)((?:[0-9A-Frx]{2}\s){0,4})(?:\s*)([A-z0-9@]+[:]+)?(?:\s*)([^;]*)/;

        this.modules.forEach(module => {
            let file = path.join(dir, module.name + ".lst");
            let m = fs.readFileSync(file);
            let lines = new TextDecoder().decode(m).split(/\r?\n/);
            let sline = 0;

            let smod = this.start_module(module);
            //let { seg_cur, seg_file, seg_base, seg_offset } = start_module(module)
            let seg_cur = smod.segment;
            let seg_file = smod.segFile;
            let seg_base = smod.segBase;
            let seg_offset = smod.segOffset;

            let seg = seg_cur;
            let macro = false;

            for (let n = 0; n < lines.length; n++) {
                let line = lines[n];

                // macro labels need special handling when producing a clean listing
    //            if (args.c && !macro && line.indexOf(".macro") >= 0) {
    //                macro = true
    //            }
    //            else if (args.c && macro && line.indexOf(".endmacro") >= 0) {
    //                macro = false
    //            }
                if (line.length >= 9 && line[8] === '1') {
                    // parse line into relative address, assembler code and source line (label and comment excluded)
                    let match: RegExpExecArray | null;
                    match = reg3.exec(line);
                    if (match) {
                        // we need source code w/o comments here to make sure any directive hasn't
                        // been commented out
                        //const { raddr, acode, label, s_source } = match.entries()
                        const raddr = match[1];
                        const acode = match[2];
                        const label = match[3];
                        const s_source = match[4];

                        // we've got the relative address, blank it out for now
                        let oline = line.replace(line.slice(0, 9), "         ");

                        // strip comments if (requested
        //                if (args.c) {
        //                    oline = clean_line(oline)
        //                }

                        // evaluate whether this line changes the segment
                        let result = reg0.exec(s_source);

                        if (result === null) {
                            // check for a default segment directive
                            this.default_segments.forEach(segment => {
                                if (s_source.indexOf(segment.directive) >= 0) {
                                    seg = segment.name;
                                }
                            });
                        }
                        else {
                            // a .segment directive was found
                            let seg0 = s_source.split(reg1);
                            if (seg0 && seg0.length > 0) {
                                seg = seg0[3];
                            }
                        }

                        if (seg !== seg_cur) {
                            // line changes segment
                            // It's possible to change segments without laying down code
                            // in which case the segment may not appear in the map file.
                            // Try to change to this segment
                            const getSeg = this.get_seg(seg);
                            const getMod = module.segments.find(s => s.name === seg);
                            if (getSeg !== undefined && getMod !== undefined) {
                                seg_base = getSeg.segBase;
                                seg_file = getSeg.segFile;
                                seg_offset = getMod.start;
                                seg_cur = seg;
                            }
                            sline++;
        //                        seg_offset = module[1][seg]
                            //    seg_file.write("\nCurrent file: " + module[0] + ".lst\n")
                            //    seg_file.write("Current segment: " + seg + "\n")
                            //    seg_file.write(oline)
                        }
                        else if (acode.length > 0 || line.slice(11, 22).indexOf("xx") >= 0) {
                            // convert relative address to absolute address
                            let addr = parseInt(raddr.slice(0, 6), 16) + seg_base + seg_offset;

                            // recreate line with abs address and without file reference
                            //if (args.c) {
                            //    oline = "%06x " % addr + "    " + oline[11:]
                            //}
                            //else {
                            //    oline = "%06x " % addr + oline[7:]
                            //}

                            // fix relative references in assembler code if applicable
                            //if (oline.indexOf(" rr ") > 0) {
                            //    let acode = oline.slice(11, 22)
                            //    let abs_acode = rtoa(args.bin_file, addr, acode)
                            //    oline = oline.replace(acode,abs_acode)
                            //}
                            //seg_file.write(oline)
                            // *** TODO: looks like we can do some consolidation here ***
                            if ((line.slice(11, 22).indexOf("xx") >= 0) || ((s_source.length > 0) && s_source.startsWith('.'))) {
                                if (label) {
                                    if (!line.includes(line.slice(24))) {
                                        console.log("source and listing don't match at module/line: " + module.name + n.toString());
                                    }
                                    sline++;
                                    let sym = this.symbolMap.get(label.slice(0, -1));
                                    if (sym) {
                                        let dir = s_source.slice(1).split(' ');
                                        switch (dir[0]) {
                                            case 'word':
                                                sym.size = 2;
                                                break;
                                            case 'dword':
                                                sym.size = 4;
                                                break;
                                            case 'res':
                                                if (dir[1][0] === '$') {
                                                    sym.size = parseInt(dir[1].slice(1), 16);
                                                } else {
                                                    sym.size = parseInt(dir[1]);
                                                }
                                                break;
                                            case 'asciiz':
                                                let i = s_source.indexOf('"');
                                                let j = s_source.lastIndexOf('"');
                                                sym.size = s_source.slice(i + 1, j).length;
                                                break;
                                            case 'byte':
                                            default:
                                                break;
                                        }
                                        sym.source = '';
                                    }
                                } else if (s_source.length > 0) {
                                    sline++;
                                }
                            } else {
                                if (s_source.length > 0) {
                                    if (!line.includes(line.slice(24))) {
                                        console.log("source and listing don't match at module/line: " + module.name + n.toString());
                                    }
    //                                sourceMap.set(addr, { module: module.name, sourceLine: sline++, listingLine: n, listing: line, source: line.slice(24) });
                                    this.sourceMap.set(addr, {
                                        address: addr,
                                        module: module.name,
                                        opcode: parseInt(acode.slice(0, 2), 16),
                                        instruction: s_source.trim(),
                                        sourceLine: sline++,
                                        listingLine: n,
                                        listing: line,
                                        source: line.slice(24)
                                    });
                                }
                            }
                            //if (args.n && acode.length > 0) {
                            //    let op = acode.slice(0, 2)
                            //    if (oline.indexOf('jmp') > 0 && (op == '4C' || op == '5C' || op == '6C' || op == '7C' || op == 'DC')) {
                            //        seg_file.write("\n;-------------------------------------\n")
                            //    }
                            //    if ((oline.indexOf('rt') > 0) && (op == '40' || op == '60' || op == '6B')) { // RTI, RTS, RTL
                            //        seg_file.write("\n;-------------------------------------\n")
                            //    }
                            //}
                        } else {
                            sline++;
                        }
        //                else if (label != undefined) {
        //                    //if (!macro) {
        //                    //    seg_file.write(oline)
        //                    //}
        //                }
        //                else if (!args.c) {
        //                    //seg_file.write(oline)
        //                }
                    }
                }
            }
        });

    //    o = open("listing.lst", "w")
    //
    //    for (seg, addr in segments.items()) {
    //        let seg_file = segFiles[seg]
    //        seg_file.seek(0)
    //        for (n, line in enumerate(seg_file.readlines(), 1)) {
    //            o.write(line)
    //        }
    //        seg_file.close()
    //        o.write("\n;-------------------------------------\n")
    //        o.write("End of " + seg + " segment")
    //        o.write("\n;-------------------------------------\n")
    //        o.write("\n\n")
    //    }
    //
    //    o.flush()
    //    o.close()
    }

    private createReverseMap() {
        this.sourceMap.forEach((source, address) => {
            let rm = this.reverseMap.get(source.module);
            if (!rm) {
                // add module to reverse map
                rm = new Map<number, number>;
                this.reverseMap.set(source.module, rm);
            }
            rm.set(source.sourceLine, address);
        });
    }

    private clean_line(line) {
        let pos = line.indexOf(';');
        if (pos >= 0) {
            return line.slice(0, pos) + "\n";
        }

        return line;
    }

    // get module's default seg, seg_file, seg_base, seg_offset
    private start_module(module: IModule): IModStart {
        // CODE segment is default and is module's first
        // segment unless it doesn't have one
        // get module's first segment and offset
        let seg = module.segments[0].name;
        let seg_offset = module.segments[0].start;

        const getSeg = this.get_seg(seg);

        //seg_file.write("\nCurrent file: " + module[0] + ".lst\n")
    //    seg_file.write("Current segment: " + seg_cur + "\n")
        return { segment: seg, segFile: getSeg!.segFile, segBase: getSeg!.segBase, segOffset: seg_offset };
    }

    private get_seg(segName: string): IGetSeg | undefined {
        let seg_base = this.segments.find(seg => seg.name === segName)?.start;
        let seg_file = this.segFiles.find(seg => seg.name === segName)?.file;

        if (seg_base === undefined || seg_file === undefined) {
            return undefined;
        } else {
            return { segFile: seg_file, segBase: seg_base };
        }

    }

    private findSymbol(symbol: string): ISymbol | undefined {
        var sym: ISymbol | undefined;

        //        for (let ln = 0; ln < this.sourceLines.length; ln++) {
        //            const line = this.sourceLines[ln].trim();
        //
        //            // parse listing code line for symbol:
        //            //     /^([a-fA-F0-9]{2})            // bank byte
        //            //     /([a-fA-F0-9]{4})             // bank address
        //            //     (?:\s*)                       // whitespace (not captured)
        //            //     (?:(?:[0-9A-Fa-fx]{2}\s){1,4})   // assembled code, 1 to 4 bytes (not captured)
        //            //     (?:\s*)                       // whitespace (not captured)
        //            //     ([A-z0-9@]+[:]+)?             // optional symbol and colon
        //            //     (?:\s*)                       // whitespace (not captured)
        //            //     ([^;]*)/;                     // instruction stripped of comment
        //
        //            let reg0 = /^([a-f0-9]{2})([a-f0-9]{4})(?:\s*)(?:(?:[0-9A-Fa-fx]{2}\s){1,4})(?:\s*)([A-z0-9@]+[:]+)?(?:\s*)([^;]*)/;
        //            let matches0: RegExpExecArray | null;
        //            matches0 = reg0.exec(line);
        //            if (matches0 !== null) {
        //                let pbr: number = parseInt(matches0[1], 16);
        //                let address: number = parseInt(matches0[2], 16);
        //                if (matches0[3] && matches0[3].slice(0, -1) === symbol) {
        //                    let instruction: string = matches0[4];
        //                    if (instruction[0] === '.') {
        //                        sym = { address: address + (pbr << 16), size: 1 };
        //                        let dir = instruction.slice(1).split(' ');
        //                        switch (dir[0]) {
        //                            case 'word':
        //                                sym.size = 2;
        //                                break;
        //                            case 'dword':
        //                                sym.size = 4;
        //                                break;
        //                            case 'res':
        //                                if(dir[1][0] === '$') {
        //                                    sym.size = parseInt(dir[1].slice(1),16);
        //                                } else {
        //                                    sym.size = parseInt(dir[1]);
        //                                }
        //                                break;
        //                            case 'byte':
        //                            default:
        //                                break;
        //                        }
        //                        break;
        //                    }
        //                }
        //            }
        //        }

                // try to find address for name
//                for (let ln = 0; ln < this.sourceLines.length; ln++) {
//                    const line = this.sourceLines[ln].trim();
//                    let index = line.indexOf(bps.name + ':');
//                    if (index >= 0) {
//                        // found label, get it's address
//                        if(index === 0) {
//                            // address is on next line
//                            ln += 1;
//                        }
//                        address = parseInt(this.sourceLines[ln].slice(0,6), 16);
//                        break;
//                    }
//                }

        return sym;
    }

    // Unlike the Mock-Debug Runtime, EE65xx is an emulator and doesn't need
    // to know anything about a source listing.  Therefore, I've passed this
    // duty to the debug adapter which will provide EE65xx with a hit bp callback.

    // Return IPosition if the line is a valid instruction otherwise return null.
    // A valid instruction line contains a 24-bit address, up to 4 bytes of
    // machine code, an optional label and an instruction, as in:
    //
    // address    machine code label   instruction
    // 00f932     BF 00 F8 00  @1:     lda f:s_build_id,x
    //
    // The regular expression used will return null for all lines except for
    // the above line and some similarly formated lines containing a directive
    // as in the following:
    //
    // 00f400     00 00        clock_speed:            .word 0
    //
    // We can reject this line because the directive in the place of the
    // instruction will always have a dot, '.' as its first character.
    //
//    private parseLine(ln: number): IPosition | null {
//        const line = this.sourceLines[ln].trim();
//
//        // parse listing code line:
//        //     /^([a-fA-F0-9]{2})            // bank byte
//        //     ([a-fA-F0-9]{4})             // bank address
//        //     (?:\s*)                       // whitespace (not captured)
//        //     ((?:[0-9A-Fa-f]{2}\s){1,4})   // assembled code, 1 to 4 bytes
//        //     (?:\s*)                       // whitespace (not captured)
//        //     (?:[A-z0-9@]+[:]+)?           // optional line label and colon (not captured)
//        //     (?:\s*)                       // whitespace (not captured)
//        //     ([^;]*)/;                     // instruction stripped of comment
//
//        let reg0 = /^([a-f0-9]{2})([a-f0-9]{4})(?:\s*)((?:[0-9A-Fa-f]{2}\s){1,4})(?:\s*)(?:[A-z0-9@]+[:]+)?(?:\s*)([^;]*)/;
//        let matches0: RegExpExecArray | null;
//        matches0 = reg0.exec(line);
//        if (matches0 !== null) {
//            let pbr: number = parseInt(matches0[1], 16);
//            let address: number = parseInt(matches0[2], 16);
////            let opcode: string = matches0[3];
//            let opcode: number = parseInt(matches0[3].slice(0,2),16);
//            let instruction: string = matches0[4];
//            if (instruction[0] !== '.') {
//                const pl: IPosition = { line: ln, address: address + (pbr << 16), opcode: opcode, instruction: instruction };
//                return pl;
//            }
//        }
//        return null;
//    }


    //function rtoa(bin_file, addr, acode)) {
    //    f = open(bin_file, "rb")
    //
    //    f.seek(addr)
    //    bytes = acode.split()
    //    for i in range(len(bytes))) {
    //        if (bytes[i] == "rr") {
    //            bytes[i] = "%02X" % (int.from_bytes(f.read(1), byteorder='little'))
    //        }
    //        else {
    //            f.seek(addr+i+1)
    //        }
    //    }
    //
    //    f.close()
    //    return " ".join(bytes).ljust(len(acode))
    //}

//    private loadSource(file: string): void {
//        if (this._sourceFile !== file) {
//            var bytes: Uint8Array;
//            this._sourceFile = this.normalizePathAndCasing(file);
//            bytes = fs.readFileSync(file);
//            this.initializeContents(bytes);
//        }
//    }

//    private initializeContents(bytes: Uint8Array) {
//        this.sourceLines = new TextDecoder().decode(bytes).split(/\r?\n/);
//    }


}
