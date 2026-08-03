# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: recovery\document-windows-integration.spec.ts >> runs the separately approved Windows Jump List known-and-missing target route
- Location: tests\recovery\document-windows-integration.spec.ts:615:1

# Error details

```
AggregateError: Jump List route and its exact shell cleanup both failed.
```

```
Error: Command failed: powershell.exe -NoProfile -NonInteractive -Sta -EncodedCommand JABFAHIAcgBvAHIAQQBjAHQAaQBvAG4AUAByAGUAZgBlAHIAZQBuAGMAZQAgAD0AIAAnAFMAdABvAHAAJwA7ACAAQQBkAGQALQBUAHkAcABlACAALQBBAHMAcwBlAG0AYgBsAHkATgBhAG0AZQAgAFUASQBBAHUAdABvAG0AYQB0AGkAbwBuAEMAbABpAGUAbgB0ADsAIABBAGQAZAAtAFQAeQBwAGUAIAAtAFQAeQBwAGUARABlAGYAaQBuAGkAdABpAG8AbgAgACcAdQBzAGkAbgBnACAAUwB5AHMAdABlAG0AOwAgAHUAcwBpAG4AZwAgAFMAeQBzAHQAZQBtAC4AUgB1AG4AdABpAG0AZQAuAEkAbgB0AGUAcgBvAHAAUwBlAHIAdgBpAGMAZQBzADsAIABwAHUAYgBsAGkAYwAgAHMAdABhAHQAaQBjACAAYwBsAGEAcwBzACAARQB0AGgAZQByAEEAMAAyAEoAdQBtAHAATABpAHMAdAAgAHsAIABbAEQAbABsAEkAbQBwAG8AcgB0ACgAIgB1AHMAZQByADMAMgAuAGQAbABsACIAKQBdACAAcAB1AGIAbABpAGMAIABzAHQAYQB0AGkAYwAgAGUAeAB0AGUAcgBuACAAYgBvAG8AbAAgAFMAZQB0AEMAdQByAHMAbwByAFAAbwBzACgAaQBuAHQAIABYACwAIABpAG4AdAAgAFkAKQA7ACAAWwBEAGwAbABJAG0AcABvAHIAdAAoACIAdQBzAGUAcgAzADIALgBkAGwAbAAiACkAXQAgAHAAdQBiAGwAaQBjACAAcwB0AGEAdABpAGMAIABlAHgAdABlAHIAbgAgAHYAbwBpAGQAIABtAG8AdQBzAGUAXwBlAHYAZQBuAHQAKAB1AGkAbgB0ACAAZgBsAGEAZwBzACwAIAB1AGkAbgB0ACAAZAB4ACwAIAB1AGkAbgB0ACAAZAB5ACwAIAB1AGkAbgB0ACAAZABhAHQAYQAsACAAVQBJAG4AdABQAHQAcgAgAGUAeAB0AHIAYQApADsAIABbAEQAbABsAEkAbQBwAG8AcgB0ACgAIgB1AHMAZQByADMAMgAuAGQAbABsACIAKQBdACAAcAB1AGIAbABpAGMAIABzAHQAYQB0AGkAYwAgAGUAeAB0AGUAcgBuACAAdgBvAGkAZAAgAGsAZQB5AGIAZABfAGUAdgBlAG4AdAAoAGIAeQB0AGUAIABrAGUAeQAsACAAYgB5AHQAZQAgAHMAYwBhAG4ALAAgAHUAaQBuAHQAIABmAGwAYQBnAHMALAAgAFUASQBuAHQAUAB0AHIAIABlAHgAdAByAGEAKQA7ACAAfQAnADsAIAAkAGkAdABlAG0ATgBhAG0AZQAgAD0AIAAnAEoAdQBtAHAAIABMAGkAcwB0ACAAMgA3ADQANgA0AGEANQA1ACAAfQFsAHQA/QAuAGUAdABoAGUAcgAnADsAIAAkAGUAdABoAGUAcgBQAGkAZAAgAD0AIAAzADgAOQA0ADAAOwAgACQAYQBwAHAATgBhAG0AZQAgAD0AIAAnAEUAdABoAGUAcgAgAFIAZQBjAG8AdgBlAHIAeQAgADIANwA0ADYANABhADUANQAnADsAIAAkAHIAbwBvAHQAIAA9ACAAWwBTAHkAcwB0AGUAbQAuAFcAaQBuAGQAbwB3AHMALgBBAHUAdABvAG0AYQB0AGkAbwBuAC4AQQB1AHQAbwBtAGEAdABpAG8AbgBFAGwAZQBtAGUAbgB0AF0AOgA6AFIAbwBvAHQARQBsAGUAbQBlAG4AdAA7ACAAJABuAGEAbQBlAEMAbwBuAGQAaQB0AGkAbwBuACAAPQAgAE4AZQB3AC0ATwBiAGoAZQBjAHQAIABTAHkAcwB0AGUAbQAuAFcAaQBuAGQAbwB3AHMALgBBAHUAdABvAG0AYQB0AGkAbwBuAC4AUAByAG8AcABlAHIAdAB5AEMAbwBuAGQAaQB0AGkAbwBuACgAWwBTAHkAcwB0AGUAbQAuAFcAaQBuAGQAbwB3AHMALgBBAHUAdABvAG0AYQB0AGkAbwBuAC4AQQB1AHQAbwBtAGEAdABpAG8AbgBFAGwAZQBtAGUAbgB0AF0AOgA6AE4AYQBtAGUAUAByAG8AcABlAHIAdAB5ACwAIAAkAGEAcABwAE4AYQBtAGUAKQA7ACAAJABwAGkAZABDAG8AbgBkAGkAdABpAG8AbgAgAD0AIABOAGUAdwAtAE8AYgBqAGUAYwB0ACAAUwB5AHMAdABlAG0ALgBXAGkAbgBkAG8AdwBzAC4AQQB1AHQAbwBtAGEAdABpAG8AbgAuAFAAcgBvAHAAZQByAHQAeQBDAG8AbgBkAGkAdABpAG8AbgAoAFsAUwB5AHMAdABlAG0ALgBXAGkAbgBkAG8AdwBzAC4AQQB1AHQAbwBtAGEAdABpAG8AbgAuAEEAdQB0AG8AbQBhAHQAaQBvAG4ARQBsAGUAbQBlAG4AdABdADoAOgBQAHIAbwBjAGUAcwBzAEkAZABQAHIAbwBwAGUAcgB0AHkALAAgACQAZQB0AGgAZQByAFAAaQBkACkAOwAgACQAZQB0AGgAZQByAFcAaQBuAGQAbwB3AHMAIAA9ACAAQAAoACQAcgBvAG8AdAAuAEYAaQBuAGQAQQBsAGwAKABbAFMAeQBzAHQAZQBtAC4AVwBpAG4AZABvAHcAcwAuAEEAdQB0AG8AbQBhAHQAaQBvAG4ALgBUAHIAZQBlAFMAYwBvAHAAZQBdADoAOgBDAGgAaQBsAGQAcgBlAG4ALAAgACQAcABpAGQAQwBvAG4AZABpAHQAaQBvAG4AKQAgAHwAIABXAGgAZQByAGUALQBPAGIAagBlAGMAdAAgAHsAIAAkAF8ALgBDAHUAcgByAGUAbgB0AC4ATgBhAHQAaQB2AGUAVwBpAG4AZABvAHcASABhAG4AZABsAGUAIAAtAG4AZQAgADAAIAB9ACkAOwAgAGkAZgAgACgAJABlAHQAaABlAHIAVwBpAG4AZABvAHcAcwAuAEMAbwB1AG4AdAAgAC0AbgBlACAAMQAgAC0AbwByACAAJABlAHQAaABlAHIAVwBpAG4AZABvAHcAcwBbADAAXQAuAEMAdQByAHIAZQBuAHQALgBOAGEAbQBlACAALQBuAGUAIAAkAGEAcABwAE4AYQBtAGUAKQAgAHsAIAB0AGgAcgBvAHcAIAAoACcASgBVAE0AUABfAEwASQBTAFQAXwBVAE4AQQBWAEEASQBMAEEAQgBMAEUAOgAgAGUAeABhAGMAdAAgAHIAZQBjAG8AdgBlAHIAeQAgAEUAdABoAGUAcgAgAHcAaQBuAGQAbwB3AC8AdABpAHQAbABlACAAbQBpAHMAbQBhAHQAYwBoACAAZgBvAHIAIABQAEkARAAgACcAIAArACAAJABlAHQAaABlAHIAUABpAGQAKQAgAH0AOwAgACQAdABhAHMAawBiAGEAcgBDAGEAbgBkAGkAZABhAHQAZQBzACAAPQAgAEAAKAAkAHIAbwBvAHQALgBGAGkAbgBkAEEAbABsACgAWwBTAHkAcwB0AGUAbQAuAFcAaQBuAGQAbwB3AHMALgBBAHUAdABvAG0AYQB0AGkAbwBuAC4AVAByAGUAZQBTAGMAbwBwAGUAXQA6ADoARABlAHMAYwBlAG4AZABhAG4AdABzACwAIAAkAG4AYQBtAGUAQwBvAG4AZABpAHQAaQBvAG4AKQAgAHwAIABXAGgAZQByAGUALQBPAGIAagBlAGMAdAAgAHsAIAAkAF8ALgBDAHUAcgByAGUAbgB0AC4AUAByAG8AYwBlAHMAcwBJAGQAIAAtAG4AZQAgACQAZQB0AGgAZQByAFAAaQBkACAALQBhAG4AZAAgACQAXwAuAEMAdQByAHIAZQBuAHQALgBDAG8AbgB0AHIAbwBsAFQAeQBwAGUAIAAtAGUAcQAgAFsAUwB5AHMAdABlAG0ALgBXAGkAbgBkAG8AdwBzAC4AQQB1AHQAbwBtAGEAdABpAG8AbgAuAEMAbwBuAHQAcgBvAGwAVAB5AHAAZQBdADoAOgBCAHUAdAB0AG8AbgAgAC0AYQBuAGQAIAAkAF8ALgBDAHUAcgByAGUAbgB0AC4AQgBvAHUAbgBkAGkAbgBnAFIAZQBjAHQAYQBuAGcAbABlAC4AVwBpAGQAdABoACAALQBnAHQAIAAwACAALQBhAG4AZAAgACQAXwAuAEMAdQByAHIAZQBuAHQALgBCAG8AdQBuAGQAaQBuAGcAUgBlAGMAdABhAG4AZwBsAGUALgBIAGUAaQBnAGgAdAAgAC0AZwB0ACAAMAAgAH0AKQA7ACAAaQBmACAAKAAkAHQAYQBzAGsAYgBhAHIAQwBhAG4AZABpAGQAYQB0AGUAcwAuAEMAbwB1AG4AdAAgAC0AbgBlACAAMQApACAAewAgAHQAaAByAG8AdwAgACgAJwBKAFUATQBQAF8ATABJAFMAVABfAFUATgBBAFYAQQBJAEwAQQBCAEwARQA6ACAAZQB4AHAAZQBjAHQAZQBkACAAbwBuAGUAIABlAHgAYQBjAHQAIAB2AGkAcwBpAGIAbABlACAAdABhAHMAawBiAGEAcgAgAGkAdABlAG0AIABuAGEAbQBlAGQAIAAnACAAKwAgACQAYQBwAHAATgBhAG0AZQAgACsAIAAnADsAIABmAG8AdQBuAGQAIAAnACAAKwAgACQAdABhAHMAawBiAGEAcgBDAGEAbgBkAGkAZABhAHQAZQBzAC4AQwBvAHUAbgB0ACAAKwAgACcALgAgAFIAZQBmAHUAcwBpAG4AZwAgAGEAbQBiAGkAZwB1AG8AdQBzACAAcwBoAGUAbABsACAAaQBuAHQAZQByAGEAYwB0AGkAbwBuAC4AJwApACAAfQA7ACAAJABpAHQAZQBtAEMAbwBuAGQAaQB0AGkAbwBuACAAPQAgAE4AZQB3AC0ATwBiAGoAZQBjAHQAIABTAHkAcwB0AGUAbQAuAFcAaQBuAGQAbwB3AHMALgBBAHUAdABvAG0AYQB0AGkAbwBuAC4AUAByAG8AcABlAHIAdAB5AEMAbwBuAGQAaQB0AGkAbwBuACgAWwBTAHkAcwB0AGUAbQAuAFcAaQBuAGQAbwB3AHMALgBBAHUAdABvAG0AYQB0AGkAbwBuAC4AQQB1AHQAbwBtAGEAdABpAG8AbgBFAGwAZQBtAGUAbgB0AF0AOgA6AE4AYQBtAGUAUAByAG8AcABlAHIAdAB5ACwAIAAkAGkAdABlAG0ATgBhAG0AZQApADsAIAAkAHAAcgBpAG8AcgBJAHQAZQBtAHMAIAA9ACAAQAAoACQAcgBvAG8AdAAuAEYAaQBuAGQAQQBsAGwAKABbAFMAeQBzAHQAZQBtAC4AVwBpAG4AZABvAHcAcwAuAEEAdQB0AG8AbQBhAHQAaQBvAG4ALgBUAHIAZQBlAFMAYwBvAHAAZQBdADoAOgBEAGUAcwBjAGUAbgBkAGEAbgB0AHMALAAgACQAaQB0AGUAbQBDAG8AbgBkAGkAdABpAG8AbgApACAAfAAgAFcAaABlAHIAZQAtAE8AYgBqAGUAYwB0ACAAewAgACQAXwAuAEMAdQByAHIAZQBuAHQALgBQAHIAbwBjAGUAcwBzAEkAZAAgAC0AbgBlACAAJABlAHQAaABlAHIAUABpAGQAIAAtAGEAbgBkACAAJABfAC4AQwB1AHIAcgBlAG4AdAAuAEIAbwB1AG4AZABpAG4AZwBSAGUAYwB0AGEAbgBnAGwAZQAuAFcAaQBkAHQAaAAgAC0AZwB0ACAAMAAgAC0AYQBuAGQAIAAkAF8ALgBDAHUAcgByAGUAbgB0AC4AQgBvAHUAbgBkAGkAbgBnAFIAZQBjAHQAYQBuAGcAbABlAC4ASABlAGkAZwBoAHQAIAAtAGcAdAAgADAAIAB9ACkAOwAgAGkAZgAgACgAJABwAHIAaQBvAHIASQB0AGUAbQBzAC4AQwBvAHUAbgB0ACAALQBuAGUAIAAwACkAIAB7ACAAdABoAHIAbwB3ACAAKAAnAEoAVQBNAFAAXwBMAEkAUwBUAF8AVQBOAEEAVgBBAEkATABBAEIATABFADoAIAB1AG4AaQBxAHUAZQAgAHIAZQBjAGUAbgB0ACAAaQB0AGUAbQAgAHcAYQBzACAAYQBsAHIAZQBhAGQAeQAgAHYAaQBzAGkAYgBsAGUAIABpAG4AIAB0AGgAZQAgAHMAaABlAGwAbAAgAGIAZQBmAG8AcgBlACAAbwBwAGUAbgBpAG4AZwAgAHQAaABlACAAZQB4AGEAYwB0ACAAcgBlAGMAbwB2AGUAcgB5ACAAdABhAHMAawBiAGEAcgAgAGkAdABlAG0AOgAgACcAIAArACAAJABpAHQAZQBtAE4AYQBtAGUAKQAgAH0AOwAgACQAdABhAHMAawBiAGEAcgAgAD0AIAAkAHQAYQBzAGsAYgBhAHIAQwBhAG4AZABpAGQAYQB0AGUAcwBbADAAXQA7ACAAJABiAG8AdQBuAGQAcwAgAD0AIAAkAHQAYQBzAGsAYgBhAHIALgBDAHUAcgByAGUAbgB0AC4AQgBvAHUAbgBkAGkAbgBnAFIAZQBjAHQAYQBuAGcAbABlADsAIAAkAHgAIAA9ACAAWwBpAG4AdABdAFsATQBhAHQAaABdADoAOgBSAG8AdQBuAGQAKAAkAGIAbwB1AG4AZABzAC4ATABlAGYAdAAgACsAIAAoACQAYgBvAHUAbgBkAHMALgBXAGkAZAB0AGgAIAAvACAAMgApACkAOwAgACQAeQAgAD0AIABbAGkAbgB0AF0AWwBNAGEAdABoAF0AOgA6AFIAbwB1AG4AZAAoACQAYgBvAHUAbgBkAHMALgBUAG8AcAAgACsAIAAoACQAYgBvAHUAbgBkAHMALgBIAGUAaQBnAGgAdAAgAC8AIAAyACkAKQA7ACAAWwBFAHQAaABlAHIAQQAwADIASgB1AG0AcABMAGkAcwB0AF0AOgA6AFMAZQB0AEMAdQByAHMAbwByAFAAbwBzACgAJAB4ACwAIAAkAHkAKQAgAHwAIABPAHUAdAAtAE4AdQBsAGwAOwAgAFsARQB0AGgAZQByAEEAMAAyAEoAdQBtAHAATABpAHMAdABdADoAOgBtAG8AdQBzAGUAXwBlAHYAZQBuAHQAKAAwAHgAMAAwADAAOAAsACAAMAAsACAAMAAsACAAMAAsACAAWwBVAEkAbgB0AFAAdAByAF0AOgA6AFoAZQByAG8AKQA7ACAAWwBFAHQAaABlAHIAQQAwADIASgB1AG0AcABMAGkAcwB0AF0AOgA6AG0AbwB1AHMAZQBfAGUAdgBlAG4AdAAoADAAeAAwADAAMQAwACwAIAAwACwAIAAwACwAIAAwACwAIABbAFUASQBuAHQAUAB0AHIAXQA6ADoAWgBlAHIAbwApADsAIABTAHQAYQByAHQALQBTAGwAZQBlAHAAIAAtAE0AaQBsAGwAaQBzAGUAYwBvAG4AZABzACAANQAwADAAOwAgAHQAcgB5ACAAewAgACQAcgBlAGMAZQBuAHQASQB0AGUAbQBzACAAPQAgAEAAKAAkAHIAbwBvAHQALgBGAGkAbgBkAEEAbABsACgAWwBTAHkAcwB0AGUAbQAuAFcAaQBuAGQAbwB3AHMALgBBAHUAdABvAG0AYQB0AGkAbwBuAC4AVAByAGUAZQBTAGMAbwBwAGUAXQA6ADoARABlAHMAYwBlAG4AZABhAG4AdABzACwAIAAkAGkAdABlAG0AQwBvAG4AZABpAHQAaQBvAG4AKQAgAHwAIABXAGgAZQByAGUALQBPAGIAagBlAGMAdAAgAHsAIAAkAF8ALgBDAHUAcgByAGUAbgB0AC4AUAByAG8AYwBlAHMAcwBJAGQAIAAtAG4AZQAgACQAZQB0AGgAZQByAFAAaQBkACAALQBhAG4AZAAgACQAXwAuAEMAdQByAHIAZQBuAHQALgBCAG8AdQBuAGQAaQBuAGcAUgBlAGMAdABhAG4AZwBsAGUALgBXAGkAZAB0AGgAIAAtAGcAdAAgADAAIAAtAGEAbgBkACAAJABfAC4AQwB1AHIAcgBlAG4AdAAuAEIAbwB1AG4AZABpAG4AZwBSAGUAYwB0AGEAbgBnAGwAZQAuAEgAZQBpAGcAaAB0ACAALQBnAHQAIAAwACAAfQApADsAIABpAGYAIAAoACQAcgBlAGMAZQBuAHQASQB0AGUAbQBzAC4AQwBvAHUAbgB0ACAALQBuAGUAIAAxACkAIAB7ACAAdABoAHIAbwB3ACAAKAAnAEoAVQBNAFAAXwBMAEkAUwBUAF8AVQBOAEEAVgBBAEkATABBAEIATABFADoAIABlAHgAcABlAGMAdABlAGQAIABvAG4AZQAgAGUAeABhAGMAdAAgAG4AZQB3AGwAeQAgAHYAaQBzAGkAYgBsAGUAIAByAGUAYwBlAG4AdAAgAGkAdABlAG0AIAAnACAAKwAgACQAaQB0AGUAbQBOAGEAbQBlACAAKwAgACcAOwAgAGYAbwB1AG4AZAAgACcAIAArACAAJAByAGUAYwBlAG4AdABJAHQAZQBtAHMALgBDAG8AdQBuAHQAIAArACAAJwAuACAAVABoAGUAIABoAG8AcwB0ACAAZABpAGQAIABuAG8AdAAgAGUAeABwAG8AcwBlACAAYQAgAHMAYQBmAGUAIABlAHgAYQBjAHQAIABKAHUAbQBwACAATABpAHMAdAAgAHQAYQByAGcAZQB0AC4AJwApACAAfQA7ACAAJAB3AGEAbABrAGUAcgAgAD0AIABbAFMAeQBzAHQAZQBtAC4AVwBpAG4AZABvAHcAcwAuAEEAdQB0AG8AbQBhAHQAaQBvAG4ALgBUAHIAZQBlAFcAYQBsAGsAZQByAF0AOgA6AEMAbwBuAHQAcgBvAGwAVgBpAGUAdwBXAGEAbABrAGUAcgA7ACAAJABwAG8AcAB1AHAAIAA9ACAAJAByAGUAYwBlAG4AdABJAHQAZQBtAHMAWwAwAF0AOwAgACQAcABhAHIAZQBuAHQAIAA9ACAAJAB3AGEAbABrAGUAcgAuAEcAZQB0AFAAYQByAGUAbgB0ACgAJABwAG8AcAB1AHAAKQA7ACAAdwBoAGkAbABlACAAKAAkAG4AdQBsAGwAIAAtAG4AZQAgACQAcABhAHIAZQBuAHQAIAAtAGEAbgBkACAAJABwAGEAcgBlAG4AdAAuAEMAdQByAHIAZQBuAHQALgBOAGEAdABpAHYAZQBXAGkAbgBkAG8AdwBIAGEAbgBkAGwAZQAgAC0AZQBxACAAMAApACAAewAgACQAcABvAHAAdQBwACAAPQAgACQAcABhAHIAZQBuAHQAOwAgACQAcABhAHIAZQBuAHQAIAA9ACAAJAB3AGEAbABrAGUAcgAuAEcAZQB0AFAAYQByAGUAbgB0ACgAJABwAG8AcAB1AHAAKQAgAH0AOwAgAGkAZgAgACgAJABwAG8AcAB1AHAALgBDAHUAcgByAGUAbgB0AC4AUAByAG8AYwBlAHMAcwBJAGQAIAAtAGUAcQAgACQAZQB0AGgAZQByAFAAaQBkACkAIAB7ACAAdABoAHIAbwB3ACAAJwBKAFUATQBQAF8ATABJAFMAVABfAFUATgBBAFYAQQBJAEwAQQBCAEwARQA6ACAAcgBlAGMAZQBuAHQAIAB0AGEAcgBnAGUAdAAgAHIAZQBzAG8AbAB2AGUAZAAgAGkAbgBzAGkAZABlACAARQB0AGgAZQByACAAcgBhAHQAaABlAHIAIAB0AGgAYQBuACAAdABoAGUAIABXAGkAbgBkAG8AdwBzACAAcwBoAGUAbABsACAAcABvAHAAdQBwACcAIAB9ADsAIAAkAGkAbgB2AG8AawBlACAAPQAgACQAcgBlAGMAZQBuAHQASQB0AGUAbQBzAFsAMABdAC4ARwBlAHQAQwB1AHIAcgBlAG4AdABQAGEAdAB0AGUAcgBuACgAWwBTAHkAcwB0AGUAbQAuAFcAaQBuAGQAbwB3AHMALgBBAHUAdABvAG0AYQB0AGkAbwBuAC4ASQBuAHYAbwBrAGUAUABhAHQAdABlAHIAbgBdADoAOgBQAGEAdAB0AGUAcgBuACkAOwAgAGkAZgAgACgAJABuAHUAbABsACAALQBlAHEAIAAkAGkAbgB2AG8AawBlACkAIAB7ACAAdABoAHIAbwB3ACAAJwBKAFUATQBQAF8ATABJAFMAVABfAFUATgBBAFYAQQBJAEwAQQBCAEwARQA6ACAAZQB4AGEAYwB0ACAAcgBlAGMAZQBuAHQAIABpAHQAZQBtACAAaABhAHMAIABuAG8AIABJAG4AdgBvAGsAZQBQAGEAdAB0AGUAcgBuACcAIAB9ADsAIAAoAFsAUwB5AHMAdABlAG0ALgBXAGkAbgBkAG8AdwBzAC4AQQB1AHQAbwBtAGEAdABpAG8AbgAuAEkAbgB2AG8AawBlAFAAYQB0AHQAZQByAG4AXQAkAGkAbgB2AG8AawBlACkALgBJAG4AdgBvAGsAZQAoACkAOwAgAFcAcgBpAHQAZQAtAE8AdQB0AHAAdQB0ACAAKAAnAHUAaQBhAC0AagB1AG0AcABsAGkAcwB0AC0AaQBuAHYAbwBrAGUAZAAgAGUAdABoAGUAcgBQAGkAZAA9ACcAIAArACAAJABlAHQAaABlAHIAUABpAGQAIAArACAAJwAgAGkAdABlAG0APQAnACAAKwAgACQAaQB0AGUAbQBOAGEAbQBlACAAKwAgACcAIAB0AGEAcwBrAGIAYQByAD0AKAAnACAAKwAgACQAeAAgACsAIAAnACwAJwAgACsAIAAkAHkAIAArACAAJwApACAAcABvAHAAdQBwAEgAdwBuAGQAPQAnACAAKwAgACQAcABvAHAAdQBwAC4AQwB1AHIAcgBlAG4AdAAuAE4AYQB0AGkAdgBlAFcAaQBuAGQAbwB3AEgAYQBuAGQAbABlACkAIAB9ACAAZgBpAG4AYQBsAGwAeQAgAHsAIABbAEUAdABoAGUAcgBBADAAMgBKAHUAbQBwAEwAaQBzAHQAXQA6ADoAawBlAHkAYgBkAF8AZQB2AGUAbgB0ACgAMAB4ADEAQgAsACAAMAAsACAAMAAsACAAWwBVAEkAbgB0AFAAdAByAF0AOgA6AFoAZQByAG8AKQA7ACAAWwBFAHQAaABlAHIAQQAwADIASgB1AG0AcABMAGkAcwB0AF0AOgA6AGsAZQB5AGIAZABfAGUAdgBlAG4AdAAoADAAeAAxAEIALAAgADAALAAgADIALAAgAFsAVQBJAG4AdABQAHQAcgBdADoAOgBaAGUAcgBvACkAIAB9AA==
#< CLIXML
<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T><T>System.Object</T></TN><MS><I64 N="SourceId">1</I64><PR N="Record"><AV>Preparing modules for first use.</AV><AI>0</AI><Nil /><PI>-1</PI><PC>-1</PC><T>Completed</T><SR>-1</SR><SD> </SD></PR></MS></Obj><S S="Error">JUMP_LIST_UNAVAILABLE: expected one exact visible taskbar item named Ether Recovery 27464a55; found 0. Refusing ambiguo_x000D__x000A_</S><S S="Error">us shell interaction._x000D__x000A_</S><S S="Error">At line:1 char:1680_x000D__x000A_</S><S S="Error">+ ... nt -ne 1) { throw ('JUMP_LIST_UNAVAILABLE: expected one exact visible ..._x000D__x000A_</S><S S="Error">+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~_x000D__x000A_</S><S S="Error">    + CategoryInfo          : OperationStopped: (JUMP_LIST_UNAVA...ll interaction.:String) [], RuntimeException_x000D__x000A_</S><S S="Error">    + FullyQualifiedErrorId : JUMP_LIST_UNAVAILABLE: expected one exact visible taskbar item named Ether Recovery 2746 _x000D__x000A_</S><S S="Error">   4a55; found 0. Refusing ambiguous shell interaction._x000D__x000A_</S><S S="Error"> _x000D__x000A_</S></Objs>
```

```
AggregateError: Journey shutdown or after-exit cleanup failed.
```

```
Error: practical Jump List route did not produce exactly one new recovery AutomaticDestinations candidate: (none).
```

```
Error: Preserved recovery artifacts after unproven restoration: root=C:\Users\deny7\AppData\Local\Temp\ether-a02-windows-integration-og6U3A; profile=C:\Users\deny7\AppData\Local\Temp\ether-recovery-journey-NT7K9F.
```

# Test source

```ts
  743 |   } catch (error) {
  744 |     jumpListFailure = error;
  745 |     journeyFailedAfterCheckpoint = shellS1 !== null;
  746 |   } finally {
  747 |     try {
  748 |       if (associationMayBeMutated && plan !== null && watchdog !== null) {
  749 |         const restorePlan = plan;
  750 |         const restoreWatchdog = watchdog;
  751 |         await restoreAssociationWithWatchdog(restorePlan, restoreWatchdog);
  752 |         associationRestorationProven = true;
  753 |       } else if (watchdog !== null) {
  754 |         await disarmAssociationRestorationWatchdog(watchdog);
  755 |         associationRestorationProven = true;
  756 |       } else if (associationArtifactsMayBeCleaned({ mutationAttempted: associationMayBeMutated, restorationProven: false, watchdogActive: false })) {
  757 |         associationRestorationProven = true;
  758 |       }
  759 |     } catch (error) {
  760 |       finalizationFailures.push(error);
  761 |     }
  762 |     if (setupSession !== null) {
  763 |       try {
  764 |         await setupSession.close("failed", {
  765 |           afterApplicationExit: async () => {
  766 |             exactProcessAbsenceProven = true;
  767 |             shellS1 ??= await resnapshotWindowsShellState(shellS0);
  768 |             setupSession?.input.observe("Capture S1 after failed ordinary setup", "S0 is diagnostic; this retained S1 is the only later restoration checkpoint.", describeWindowsShellSetupDelta(shellS0, shellS1));
  769 |           }
  770 |         });
  771 |         setupSession = null;
  772 |       } catch (error) {
  773 |         finalizationFailures.push(error);
  774 |       }
  775 |     }
  776 |     if (session !== null && primaryPid !== null) {
  777 |       try {
  778 |         await closeExactWindowWithNativeKeyboard(primaryPid);
  779 |       } catch (error) {
  780 |         finalizationFailures.push(error);
  781 |       }
  782 |     }
  783 |     if (session !== null) {
  784 |       try {
  785 |         await session.close("failed", {
  786 |           afterApplicationExit: async () => {
  787 |             exactProcessAbsenceProven = true;
  788 |             if (recentModeLaunched && !jumpListShellStateRestored) {
  789 |               if (shellS1 === null) throw new Error("S1 shell checkpoint was not captured before approved Jump List cleanup.");
  790 |               if (s1RecentShortcutPaths === null) throw new Error("S1 Recent shortcut baseline was not captured before approved Jump List cleanup.");
  791 |               await recordShellFinalizationAttempt({ action: "failed Jump List close sanitation", exactProcessAbsenceProven, jumpState: jumpListCleanupState, sidecar: shellFinalizationSidecar, sanitize: () => restoreApprovedJumpListShellState({ before: shellS1!, documentPaths: [documentPath], profile, root, s1RecentShortcutPaths: s1RecentShortcutPaths!, state: jumpListCleanupState, token: shellToken }) });
  792 |               jumpListShellStateRestored = true;
  793 |             }
  794 |           }
  795 |         });
  796 |         session = null;
  797 |       } catch (error) {
  798 |         finalizationFailures.push(error);
  799 |       }
  800 |     }
  801 |     if (session === null && recentModeLaunched && !jumpListShellStateRestored && shellS1 !== null && s1RecentShortcutPaths !== null && exactProcessAbsenceProven) {
  802 |       try {
  803 |         await recordShellFinalizationAttempt({ action: "no-session Jump List sanitation retry", exactProcessAbsenceProven, jumpState: jumpListCleanupState, sidecar: shellFinalizationSidecar, sanitize: () => restoreApprovedJumpListShellState({ allowNoCandidate: true, before: shellS1!, documentPaths: [documentPath], profile, root, s1RecentShortcutPaths: s1RecentShortcutPaths!, state: jumpListCleanupState, token: shellToken }) });
  804 |         jumpListShellStateRestored = true;
  805 |       } catch (error) {
  806 |         finalizationFailures.push(error);
  807 |       }
  808 |     }
  809 |     if (session === null && recentModeLaunched && !jumpListShellStateRestored && shellS1 !== null && s1RecentShortcutPaths !== null && !exactProcessAbsenceProven) {
  810 |       try {
  811 |         await recordShellFinalizationBlocked({ action: "no-session Jump List sanitation blocked", exactProcessAbsenceProven, jumpState: jumpListCleanupState, reason: "Exact process absence was not proven; sanitation was not attempted.", sidecar: shellFinalizationSidecar });
  812 |       } catch (error) {
  813 |         finalizationFailures.push(error);
  814 |       }
  815 |     }
  816 |     if (jumpListFailure !== null && shellFinalizationSidecar.attempts.length === 0) {
  817 |       try {
  818 |         await recordShellFinalizationBlockedOnce({ action: "Jump List no-session finalization blocked", exactProcessAbsenceProven, jumpState: jumpListCleanupState, reason: exactProcessAbsenceProven ? "S1 prerequisites were unavailable; sanitation was not attempted." : "Exact process absence was not proven; sanitation was not attempted.", sidecar: shellFinalizationSidecar });
  819 |       } catch (error) {
  820 |         finalizationFailures.push(error);
  821 |       }
  822 |     }
  823 |     try {
  824 |       await ensureShellFinalizationSidecarDurable(shellFinalizationSidecar);
  825 |     } catch (error) {
  826 |       finalizationFailures.push(error);
  827 |     }
  828 |     if (associationRestorationProven && recoveryArtifactsMayBeCleanedAfterShellCheckpoint({
  829 |       checkpointCaptured: shellS1 !== null,
  830 |       exactProcessAbsenceProven,
  831 |       finalizationFailuresAbsent: finalizationFailures.length === 0,
  832 |       journeyFailedAfterCheckpoint,
  833 |       sidecarDurabilityProven: shellFinalizationSidecar.durabilityProven && !shellFinalizationSidecar.durabilityFailureObserved,
  834 |       shellCheckpointRestored: jumpListShellStateRestored
  835 |     })) {
  836 |       try {
  837 |         await cleanupIsolatedJourneyProfile(profile);
  838 |         await cleanupWindowsIntegrationRoot(root);
  839 |       } catch (error) {
  840 |         finalizationFailures.push(error);
  841 |       }
  842 |     } else {
> 843 |       finalizationFailures.push(new Error(`Preserved recovery artifacts after unproven restoration: root=${root}; profile=${profile.root}.`));
      |                                 ^ Error: Preserved recovery artifacts after unproven restoration: root=C:\Users\deny7\AppData\Local\Temp\ether-a02-windows-integration-og6U3A; profile=C:\Users\deny7\AppData\Local\Temp\ether-recovery-journey-NT7K9F.
  844 |     }
  845 |   }
  846 |   if (jumpListFailure !== null) {
  847 |     if (finalizationFailures.length > 0) {
  848 |       throw new AggregateError([jumpListFailure, ...finalizationFailures], "Jump List route and its exact shell cleanup both failed.", { cause: finalizationFailures.at(-1) });
  849 |     }
  850 |     throw jumpListFailure;
  851 |   }
  852 |   if (finalizationFailures.length > 0) {
  853 |     throw new AggregateError(finalizationFailures, "Jump List finalization failed.", { cause: finalizationFailures.at(-1) });
  854 |   }
  855 | });
  856 | 
  857 | async function restoreAssociationWithWatchdog(
  858 |   plan: ReversibleAssociationPlan | null,
  859 |   watchdog: AssociationRestorationWatchdog | null
  860 | ): Promise<void> {
  861 |   if (plan === null || watchdog === null) throw new Error("Association restoration guard was not fully initialized.");
  862 |   try {
  863 |     await restoreReversibleAssociation(plan);
  864 |   } catch (primaryError) {
  865 |     try {
  866 |       await triggerAssociationRestorationWatchdog(watchdog);
  867 |       await restoreReversibleAssociation(plan);
  868 |     } catch (watchdogError) {
  869 |       throw new AggregateError([primaryError, watchdogError], "Both primary and watchdog association restoration failed.", { cause: watchdogError });
  870 |     }
  871 |     throw primaryError;
  872 |   }
  873 |   await disarmAssociationRestorationWatchdog(watchdog);
  874 | }
  875 | 
  876 | /** S1 is the first restore obligation; S0 only documents unavoidable native setup deltas. */
  877 | async function assertShellCheckpointRestored(s1: WindowsShellStateSnapshot): Promise<void> {
  878 |   assertWindowsShellCheckpointStable(s1, await resnapshotWindowsShellState(s1));
  879 | }
  880 | 
  881 | async function snapshotS1TargetShortcuts(input: {
  882 |   documentPaths: readonly string[];
  883 |   profile: RecoveryJourneySession["profile"];
  884 |   root: string;
  885 | }): Promise<string[]> {
  886 |   const realAppData = process.env.APPDATA;
  887 |   if (realAppData === undefined) throw new Error("S1 target-link checkpoint requires the real APPDATA path.");
  888 |   const paths = [
  889 |     ...await snapshotTestOwnedRecentShortcuts({ appData: input.profile.appData, root: input.root, documentPaths: input.documentPaths }),
  890 |     ...await snapshotTestOwnedRecentShortcuts({ appData: realAppData, root: input.root, documentPaths: input.documentPaths })
  891 |   ];
  892 |   requireNoTestOwnedRecentShortcuts(paths);
  893 |   return paths;
  894 | }
  895 | 
  896 | async function classifyShellAfterExactExit(input: {
  897 |   documentPaths: readonly string[];
  898 |   profile: RecoveryJourneySession["profile"];
  899 |   root: string;
  900 |   s0: WindowsShellStateSnapshot;
  901 |   s1: WindowsShellStateSnapshot;
  902 |   s1TargetShortcuts: readonly string[];
  903 | }): Promise<string> {
  904 |   const realAppData = process.env.APPDATA;
  905 |   if (realAppData === undefined) throw new Error("Post-exit shell classification requires the real APPDATA path.");
  906 |   requireNoTestOwnedRecentShortcuts(input.s1TargetShortcuts);
  907 |   const removed = await cleanupTestOwnedRecentShortcuts({
  908 |     appData: input.profile.appData,
  909 |     additionalAppData: [realAppData],
  910 |     root: input.root,
  911 |     documentPaths: input.documentPaths,
  912 |     s1: input.s1
  913 |   });
  914 |   const final = await resnapshotWindowsShellState(input.s1);
  915 |   const s1Classification = classifyWindowsShellStateChanges(input.s1, final);
  916 |   assertWindowsShellClassificationClean(s1Classification, "S1→final");
  917 |   const s0Changes = compareWindowsShellState(input.s0, final);
  918 |   return `removed exact post-S1 target links=${removed.length}${removed.length === 0 ? "" : `: ${removed.join(", ")}`}; S0→final=${formatWindowsShellStateChanges(s0Changes) || "(none)"}; S1→final allowed opaque=${formatWindowsShellStateChanges(s1Classification.allowedOpaqueModifications) || "(none)"}`;
  919 | }
  920 | 
  921 | /**
  922 |  * The sole COM cleanup route is deliberately local to the separately approved
  923 |  * Jump List journey. It proves that every affected real/isolated Recent file
  924 |  * is one new recovery-AUMID AutomaticDestinations artifact before recycling it.
  925 |  */
  926 | type JumpListShellCleanupState = {
  927 |   candidate?: { appData: string; relativePath: string };
  928 |   comInvocations: number;
  929 |   disposition?: string;
  930 |   j0?: WindowsShellStateSnapshot;
  931 |   j1?: WindowsShellStateSnapshot;
  932 |   recycleInvocations: number;
  933 |   removedShortcuts: string[];
  934 |   s1ToJ0AllowedOpaque: WindowsShellStateChange[];
  935 |   stage: "new" | "j0-captured" | "com-invoked" | "j1-captured" | "recycle-invoked" | "j2-verified" | "no-candidate";
  936 |   transitions: string[];
  937 | };
  938 | 
  939 | function createJumpListShellCleanupState(): JumpListShellCleanupState {
  940 |   return { comInvocations: 0, recycleInvocations: 0, removedShortcuts: [], s1ToJ0AllowedOpaque: [], stage: "new", transitions: [] };
  941 | }
  942 | 
  943 | async function restoreApprovedJumpListShellState(input: {
```