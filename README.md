# db65816
VS Code debugger for 65816 assembly code

![Screenshot of db65816 debugger](img/db65816.png)

# Features
* Runs a program from reset vector, optionally stopping on entry
* Supports multi-file programs
* Can set launch arguments for program
* Follow along with execution directly in assembly source files
* Control program execution with continue/pause, single step, step-into, step-over,  step-out and run-to-cursor
* Four types of breakpoints (conditional breakpoints not yet supported):
    * Source: set directly in assembly source files; stops execution when that line is reached
    * Function: set on function name or memory address; stops execution when that function is entered or memory address is reached during program execution
    * Data: set on X, Y, K, B and D register; stops execution when a write access to these registers is made
    * Instruction mnemonic or opcode (opcode allows a break even if there is no supporting source code)
* Registers and hardware stack displayed in Variables pane and can be modified when program is paused
* Watch pane functional for program symbols and memory addresses (not expressions) and the values of these can be changed when the program is paused
* Variable/watch changes highlighted after each step and on execution pause
* Drill down on variables/watches that represent a memory range (variable ranges can be opened in a separate hex editor window allowing modification of the memory range)
* Symbol address and value displayed when hovering over a symbol in source code
* Call stack displayed when stepping through program.  Clicking on an entry opens the source code in an editor at that line.  On continue, call stack colapses stack to current instruction.
* Integrated terminal window for input/output
* Source files listed in debug pane Loaded Scripts Explorer

# Requirements
db65816 is a VS Code extension (under development) that simulates Western Design Center's [65C816 microprocessor](https://www.wdc65xx.com/wdc/documentation/w65c816s.pdf).  The extension impliments Microsoft's Debug Adapter Protocol to communicate with the VS Code debugging frontend and translates UI commands to control an execution engine simulating the 65C816.  The execution engine "runs" a binary file of the assembled code and can be used independently of the debugging extension.

The extension monitors the execution engine activity and translates it's state into various elements to be displayed in the VS Code UI.  To do so, it uses mapping, listing and symbol files produced during source code assembly.  The extension works with [cc65](https://github.com/cc65/cc65) files to produce an address map between the assembly source files and the assembled binary.  It shouldn't be difficult to modify the extension to create a mapping for other 65C816 assemblers. Unfortunately a disassembly of the binary is not practical.  (The experienced 65C816 user will understand that disassembly of 65816 code is problematic without some constraints set on changing the processor's registers size).

# Execution Engine
The core of the execution engine is a Typescript port of the core of my [py65816](https://github.com/tmr4/py65816) Python simulator package.  The Python version has been tested with unit tests covering about 98% of the code (see the link for limitations).  Similar tests have not been made on the Typescript core but it has successfully passed a significant set of functional tests.  I don't plan on porting the Python unit tests as it's code base is significantly larger than just the core alone.  As always, use at your own risk.

# Installation
Clone this repository and open it in VS Code.  Open a terminal and type `install npm`.  You should be ready to run the hello world example.

# Hello World Example
I've included a very simple "hello world" example project in the [wp](wp/hello_world.s) folder.  To run it, open the debug adapter extension project in VS Code and press F5 to start debugging.  VS Code will open a new window where you can run the hello world example.  Open hello_world.s, make sure "Debug File" is selected in the VS Code debug pane and press F5.  The program should pause at the start of the reset subroutine.

![Screenshot of db65816 debugger](img/hello_world.png)

# Status and Limitations
1. This is a work in progress and will likely remain so.  I make no claims to its usability or suitability for your uses.  Coding is just a hobby for me, so take care.  Much of the code hasn't been rigorously tested,is without error checking and likely is inefficient.  Still, hopefully it will help others get past the limited documentation regarding VS Code's implimentation of Microsoft's [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/).  Another good starting point is Microsoft's [Mock-Debug](https://github.com/Microsoft/vscode-mock-debug) which was the starting point for this project.
2. Resolved (10/24/2022): This seems to have resolved itself as I updated the repository.  Downloading the zipped repository no longer receives a warning.  Original issue: I got a Windows Defender warning of a Wacatac Trogen when downloading the zipped repository from GitHub.  My local repository and zips of them scan clean so this is likely a false positive.  However, if you are concerned, don't download or clone the repository.  It will be interesting to see if this continues as I update the repository.
3. more to come...

