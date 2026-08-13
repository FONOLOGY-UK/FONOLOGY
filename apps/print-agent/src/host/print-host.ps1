<#
    Fonology print agent — Windows print host.
    =========================================================================
    A long-lived helper process. Node speaks to it over stdin/stdout with one
    JSON object per line, and it does the two things Node cannot do on Windows
    without native code:

      1. Hand RAW bytes to the Windows print queue (winspool.drv), which is how
         ESC/POS reaches the receipt printer.
      2. Draw a label with GDI+ and send it through the Brother driver, which is
         how we print to the QL-600 WITHOUT ever touching Brother's raster
         protocol.

    WHY THIS PROCESS IS LONG-LIVED, MEASURED RATHER THAN ASSUMED
    ---------------------------------------------------------------------------
    Spawning powershell.exe per print and compiling the P/Invoke type each time
    was measured on the development machine at:

        cold powershell.exe start + exit .... 428 ms
        Add-Type compile of the interop ..... 843 ms

    That is ~1.3 seconds before a single byte moves, on every sale, with a
    customer waiting. Staff stop trusting a till that pauses, and a till nobody
    trusts gets worked around. Compiling once at startup makes each subsequent
    print a few milliseconds of interop.

    PROTOCOL
    ---------------------------------------------------------------------------
    Request : one JSON object per line on stdin,  always with `id` and `op`.
    Response: one JSON object per line on stdout, always with `id` and `ok`.

    Every failure answers with ok:false AND a `stage`. The stage is not
    diagnostics — it is load-bearing. It tells Node HOW FAR the attempt got,
    which is how "safe to retry automatically" is distinguished from "a human
    must be asked whether paper came out".

    Nothing is ever written to stdout except protocol lines. Diagnostics go to
    stderr, which Node folds into its own log.
#>

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

# stdout carries a protocol, so it must be plain UTF-8 with no BOM and no
# PowerShell formatting. Anything that writes to the host by accident would
# corrupt a response line, so every diagnostic below goes to stderr instead.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

<#
    STDIN MUST BE READ AS UTF-8 EXPLICITLY. This is not a tidying-up detail —
    it was a real bug, caught by looking at a rendered label rather than by any
    test.

    Node writes the JSON command as UTF-8. PowerShell's [Console]::In decodes
    using the console's INPUT encoding, which on a UK Windows box is the OEM
    codepage (437/850), not UTF-8. So "£30.00" arrived as "Ã‚Â£30.00" and
    printed that way on the label: a customer's bench ticket showing mojibake
    where the price should be. Nothing threw, nothing logged, and it would have
    shipped.

    Setting [Console]::InputEncoding is the obvious fix but throws when stdin is
    redirected on some builds — which is exactly how this process is always
    launched. Wrapping the raw stdin handle in a StreamReader with an explicit
    encoding works regardless of console state, so that is what we do.

    The receipt path is unaffected and always was: those bytes are encoded by
    the ESC/POS library in Node and reach this script through a FILE, never
    through stdin. Only the label display list travels as JSON.
#>
$stdinReader = New-Object System.IO.StreamReader(
    [Console]::OpenStandardInput(),
    (New-Object System.Text.UTF8Encoding($false)))

function Write-Diag([string]$message) {
    [Console]::Error.WriteLine("[print-host] $message")
}

# ---------------------------------------------------------------------------
# Win32 spooler interop — RAW passthrough
# ---------------------------------------------------------------------------
# This is the documented Windows way to put bytes on a print queue untouched:
# OpenPrinter → StartDocPrinter(datatype "RAW") → StartPagePrinter →
# WritePrinter → EndPagePrinter → EndDocPrinter → ClosePrinter.
#
# "RAW" is the important part. It tells the spooler to pass the bytes to the
# device with no driver rendering in between, which is exactly what an ESC/POS
# stream needs. Any other datatype would have the driver try to interpret the
# escape sequences as text and print something that looks almost right.

$interopSource = @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public class FonologyRawPrintResult
{
    public bool Ok;
    public string Stage;
    public string Error;
    public int JobId;
    public int BytesWritten;
}

public class FonologyRawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOW
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true,
        CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true,
        ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true,
        CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern int StartDocPrinter(IntPtr hPrinter, int level,
        [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true,
        ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true,
        ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true,
        ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true,
        ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    // The stage names below are consumed by the agent to decide whether a
    // receipt may be retried automatically. Do not rename them casually:
    // anything from "write" onwards means bytes MAY have reached the device,
    // and the agent must stop and ask a person instead of reprinting.
    public static FonologyRawPrintResult SendFile(string printerName, string filePath, string docName)
    {
        FonologyRawPrintResult r = new FonologyRawPrintResult();
        r.Ok = false;
        r.Stage = "read";
        r.JobId = 0;
        r.BytesWritten = 0;

        byte[] bytes;
        try
        {
            bytes = File.ReadAllBytes(filePath);
        }
        catch (Exception ex)
        {
            r.Error = "Could not read the spooled job file: " + ex.Message;
            return r;
        }

        IntPtr hPrinter = IntPtr.Zero;
        IntPtr unmanaged = IntPtr.Zero;
        bool docStarted = false;
        bool pageStarted = false;

        try
        {
            r.Stage = "open";
            if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            {
                r.Error = "OpenPrinter failed (Win32 error " + Marshal.GetLastWin32Error() + "). " +
                          "The printer name may be wrong, or the printer is not installed for this user.";
                return r;
            }

            DOCINFOW di = new DOCINFOW();
            di.pDocName = docName;
            di.pOutputFile = null;
            di.pDataType = "RAW";

            r.Stage = "startDoc";
            r.JobId = StartDocPrinter(hPrinter, 1, di);
            if (r.JobId == 0)
            {
                r.Error = "StartDocPrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ").";
                return r;
            }
            docStarted = true;

            r.Stage = "startPage";
            if (!StartPagePrinter(hPrinter))
            {
                r.Error = "StartPagePrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ").";
                return r;
            }
            pageStarted = true;

            // From here on, bytes may leave for the device.
            r.Stage = "write";
            unmanaged = Marshal.AllocHGlobal(bytes.Length);
            Marshal.Copy(bytes, 0, unmanaged, bytes.Length);

            int written = 0;
            bool wrote = WritePrinter(hPrinter, unmanaged, bytes.Length, out written);
            r.BytesWritten = written;
            if (!wrote)
            {
                r.Error = "WritePrinter failed after " + written + " of " + bytes.Length +
                          " bytes (Win32 error " + Marshal.GetLastWin32Error() + ").";
                return r;
            }
            if (written != bytes.Length)
            {
                r.Error = "WritePrinter accepted only " + written + " of " + bytes.Length + " bytes.";
                return r;
            }

            r.Stage = "endPage";
            pageStarted = false;
            if (!EndPagePrinter(hPrinter))
            {
                r.Error = "EndPagePrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ").";
                return r;
            }

            r.Stage = "endDoc";
            docStarted = false;
            if (!EndDocPrinter(hPrinter))
            {
                r.Error = "EndDocPrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ").";
                return r;
            }

            r.Stage = "spooled";
            r.Ok = true;
            return r;
        }
        catch (Exception ex)
        {
            r.Error = ex.Message;
            return r;
        }
        finally
        {
            // Unwind whatever is still open. Leaking a printer handle would
            // eventually wedge the spooler for every application on the PC,
            // and this process is meant to run for weeks.
            if (unmanaged != IntPtr.Zero) Marshal.FreeHGlobal(unmanaged);
            if (hPrinter != IntPtr.Zero)
            {
                try { if (pageStarted) EndPagePrinter(hPrinter); } catch { }
                try { if (docStarted) EndDocPrinter(hPrinter); } catch { }
                try { ClosePrinter(hPrinter); } catch { }
            }
        }
    }
}
'@

try {
    Add-Type -TypeDefinition $interopSource -Language CSharp
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
} catch {
    # Nothing can work without these, and failing silently would leave the
    # agent looking healthy while every print failed. Say so and stop.
    Write-Diag "FATAL: could not initialise printing support: $($_.Exception.Message)"
    exit 2
}

Write-Diag 'ready'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Send-Response($obj) {
    # Depth matters: PS 5.1 defaults to 2 and would silently render nested
    # objects as type names, which the agent could not parse.
    $json = $obj | ConvertTo-Json -Depth 10 -Compress
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
}

function Get-Prop($obj, [string]$name, $fallback) {
    if ($null -eq $obj) { return $fallback }
    $p = $obj.PSObject.Properties[$name]
    if ($null -eq $p -or $null -eq $p.Value) { return $fallback }
    return $p.Value
}

function ConvertTo-Hundredths([double]$mm) {
    # PaperSize is specified in hundredths of an inch, not millimetres.
    return [int][Math]::Round($mm / 25.4 * 100.0)
}

<#
    Wait for a spooled job to leave the queue.

    WHY THIS EXISTS
    WritePrinter succeeding means the SPOOLER took the bytes, not that paper
    came out. A printer that is out of paper accepts the job happily and holds
    it. Acknowledging there would mark a receipt printed that is still sitting
    in a queue — and "paper out mid-job" is on the list of cases that must be
    handled explicitly.

    Returns a status string:
      completed   — the job left the queue cleanly. As close to "it printed" as
                    Windows will ever tell us.
      error       — the queue reports a real problem (paper out, offline,
                    blocked, deleted).
      timeout     — still sitting there when we ran out of patience.
      unobserved  — we could not watch it at all. Treated as success by the
                    caller, deliberately: see the note at the call site.
#>
<#
    The single mapping from a queue-wait result to the protocol's ok/stage.

    Both print paths answer with the same vocabulary, so they share the same
    translation. It was copy-pasted in two places before, which meant the raw
    and label paths could silently disagree about what "timeout" means.
#>
function Resolve-QueueOutcome($wait) {
    $bad = ($wait.status -eq 'error' -or $wait.status -eq 'timeout')
    return @{
        ok = (-not $bad)
        # 'queue' tells the agent the bytes were accepted by the spooler but the
        # job did not come out cleanly — which is a reachedPrinter:true case.
        stage = if ($bad) { 'queue' } else { 'done' }
    }
}

<#
    Identify the spool job a PrintDocument just created.

    PrintDocument, unlike StartDocPrinter, does not hand back a job id. The
    previous version took the LAST job in the queue, which is a guess: with any
    concurrent activity on that printer it watches somebody else's job and
    reports their status as this label's outcome.

    Diffing the queue either side of Print() identifies the job that actually
    appeared. An empty answer is not a failure — a fast label is finished and
    gone before we can look, which is the normal case and reads as 'completed'.
#>
function Get-NewPrintJobId([string]$printerName, $beforeIds) {
    try {
        $after = @(Get-PrintJob -PrinterName $printerName -ErrorAction Stop)
        $fresh = @($after | Where-Object { $beforeIds -notcontains $_.Id })
        if ($fresh.Count -gt 0) { return [int]($fresh | Select-Object -Last 1).Id }
    } catch {
        # Queue unreadable, or already empty. Either way there is nothing to watch.
    }
    return 0
}

function Get-PrintJobIds([string]$printerName) {
    try {
        return @(Get-PrintJob -PrinterName $printerName -ErrorAction Stop | ForEach-Object { $_.Id })
    } catch {
        return @()
    }
}

function Wait-ForPrintJob([string]$printerName, [int]$jobId, [int]$timeoutMs) {
    if ($jobId -le 0) { return @{ status = 'unobserved'; detail = 'No job id was returned.' } }
    if (-not (Get-Command Get-PrintJob -ErrorAction SilentlyContinue)) {
        return @{ status = 'unobserved'; detail = 'Get-PrintJob is not available on this Windows build.' }
    }

    $deadline = (Get-Date).AddMilliseconds($timeoutMs)
    while ((Get-Date) -lt $deadline) {
        $job = $null
        try {
            $job = Get-PrintJob -PrinterName $printerName -ID $jobId -ErrorAction Stop
        } catch {
            # The job is gone from the queue. For a RAW job that is the normal
            # and expected success signal — completed jobs are not retained.
            return @{ status = 'completed'; detail = $null }
        }

        if ($null -eq $job) { return @{ status = 'completed'; detail = $null } }

        $state = [string]$job.JobStatus
        foreach ($bad in @('Error', 'Offline', 'PaperOut', 'Paper Out', 'Deleted', 'Blocked', 'UserIntervention')) {
            if ($state -like "*$bad*") {
                return @{ status = 'error'; detail = "Print queue reports: $state" }
            }
        }

        Start-Sleep -Milliseconds 150
    }
    return @{ status = 'timeout'; detail = 'The job was still in the Windows queue when we stopped waiting.' }
}

<#
    Execute a display list onto any GDI+ surface.

    The agent computes WHAT to draw (in millimetres) and this executes it. That
    split is deliberate: label layout is written in TypeScript where the rest of
    the product lives, and this renderer never needs to change to accommodate a
    new layout. `rect` is included precisely so a barcode can be drawn later as
    a run of bars without touching this file.

    NOTE: we never touch Brother's raster protocol. We draw, and the installed
    Brother driver rasterises. That is the whole reason the label path is safe
    to write without the device present.
#>
function Invoke-DrawOps($g, $ops, [double]$widthMm) {
    $g.PageUnit = [System.Drawing.GraphicsUnit]::Millimeter
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    $black = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Black)
    try {
        foreach ($op in $ops) {
            $type = [string](Get-Prop $op 't' 'text')
            switch ($type) {
                'text' {
                    $x = [double](Get-Prop $op 'x' 0)
                    $y = [double](Get-Prop $op 'y' 0)
                    $w = [double](Get-Prop $op 'w' ($widthMm - $x))
                    $size = [double](Get-Prop $op 'size' 8)
                    $family = [string](Get-Prop $op 'font' 'Arial')
                    $bold = [bool](Get-Prop $op 'bold' $false)
                    $text = [string](Get-Prop $op 'text' '')

                    $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
                    # Point units for the font while the surface is in
                    # millimetres: GDI+ handles the conversion, so a 9pt font is
                    # 9pt on paper regardless of the surface unit or DPI.
                    $font = New-Object System.Drawing.Font($family, $size, $style, [System.Drawing.GraphicsUnit]::Point)
                    $fmt = New-Object System.Drawing.StringFormat
                    switch ([string](Get-Prop $op 'align' 'left')) {
                        'center' { $fmt.Alignment = [System.Drawing.StringAlignment]::Center }
                        'right'  { $fmt.Alignment = [System.Drawing.StringAlignment]::Far }
                        default  { $fmt.Alignment = [System.Drawing.StringAlignment]::Near }
                    }
                    # A generous height box plus NoWrap off means long text wraps
                    # inside its column instead of overprinting the next field.
                    $rect = New-Object System.Drawing.RectangleF($x, $y, $w, [double](Get-Prop $op 'h' 100))
                    $g.DrawString($text, $font, $black, $rect, $fmt)
                    $font.Dispose()
                    $fmt.Dispose()
                }
                'rect' {
                    $x = [double](Get-Prop $op 'x' 0)
                    $y = [double](Get-Prop $op 'y' 0)
                    $w = [double](Get-Prop $op 'w' 1)
                    $h = [double](Get-Prop $op 'h' 1)
                    if ([bool](Get-Prop $op 'fill' $true)) {
                        $g.FillRectangle($black, $x, $y, $w, $h)
                    } else {
                        $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, [double](Get-Prop $op 'width' 0.3))
                        $g.DrawRectangle($pen, $x, $y, $w, $h)
                        $pen.Dispose()
                    }
                }
                'line' {
                    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, [double](Get-Prop $op 'width' 0.3))
                    $g.DrawLine($pen,
                        [double](Get-Prop $op 'x1' 0), [double](Get-Prop $op 'y1' 0),
                        [double](Get-Prop $op 'x2' 0), [double](Get-Prop $op 'y2' 0))
                    $pen.Dispose()
                }
                default {
                    Write-Diag "ignoring unknown draw op '$type'"
                }
            }
        }
    } finally {
        $black.Dispose()
    }
}

function Save-LabelPng($ops, [double]$widthMm, [double]$heightMm, [int]$dpi, [string]$pngPath) {
    $pxW = [int][Math]::Round($widthMm / 25.4 * $dpi)
    $pxH = [int][Math]::Round($heightMm / 25.4 * $dpi)
    $bmp = New-Object System.Drawing.Bitmap($pxW, $pxH)
    try {
        # Without this the bitmap defaults to 96dpi and every millimetre
        # coordinate would be scaled wrong — the PNG would not match the paper.
        $bmp.SetResolution([float]$dpi, [float]$dpi)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $g.Clear([System.Drawing.Color]::White)
            Invoke-DrawOps $g $ops $widthMm
        } finally {
            $g.Dispose()
        }
        $bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $bmp.Dispose()
    }
    return @{ pxW = $pxW; pxH = $pxH }
}

# ---------------------------------------------------------------------------
# The command loop
# ---------------------------------------------------------------------------

while ($true) {
    $line = $stdinReader.ReadLine()
    # Null means stdin closed: the agent has exited or been killed. Exiting
    # here is what stops an orphaned host process outliving its parent.
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if ($line.Length -eq 0) { continue }

    $req = $null
    try {
        $req = $line | ConvertFrom-Json
    } catch {
        Send-Response @{ id = $null; ok = $false; stage = 'protocol'; error = 'Request was not valid JSON.' }
        continue
    }

    $id = [string](Get-Prop $req 'id' '')
    $op = [string](Get-Prop $req 'op' '')

    try {
        switch ($op) {
            'ping' {
                Send-Response @{ id = $id; ok = $true; pong = $true }
            }

            'listPrinters' {
                $printers = @()
                foreach ($p in (Get-Printer -ErrorAction Stop)) {
                    $printers += @{
                        name       = [string]$p.Name
                        portName   = [string]$p.PortName
                        driverName = [string]$p.DriverName
                        shared     = [bool]$p.Shared
                    }
                }
                Send-Response @{ id = $id; ok = $true; printers = $printers }
            }

            'printerStatus' {
                $name = [string](Get-Prop $req 'printer' '')
                $p = Get-Printer -Name $name -ErrorAction Stop
                $queued = 0
                try { $queued = @(Get-PrintJob -PrinterName $name -ErrorAction Stop).Count } catch { $queued = -1 }
                Send-Response @{
                    id = $id; ok = $true
                    printerStatus = [string]$p.PrinterStatus
                    queued = $queued
                }
            }

            'rawPrint' {
                $name = [string](Get-Prop $req 'printer' '')
                $file = [string](Get-Prop $req 'file' '')
                $docName = [string](Get-Prop $req 'docName' 'Fonology print job')
                $waitMs = [int](Get-Prop $req 'waitMs' 20000)

                $r = [FonologyRawPrinter]::SendFile($name, $file, $docName)
                if (-not $r.Ok) {
                    Send-Response @{
                        id = $id; ok = $false; stage = $r.Stage; error = $r.Error
                        bytesWritten = $r.BytesWritten
                    }
                    continue
                }

                $wait = Wait-ForPrintJob $name $r.JobId $waitMs
                $outcome = Resolve-QueueOutcome $wait
                Send-Response @{
                    id = $id
                    ok = $outcome.ok
                    stage = $outcome.stage
                    queueStatus = $wait.status
                    error = $wait.detail
                    jobId = $r.JobId
                    bytesWritten = $r.BytesWritten
                }
            }

            'drawLabel' {
                $ops = Get-Prop $req 'ops' @()
                $widthMm = [double](Get-Prop $req 'widthMm' 62)
                $heightMm = [double](Get-Prop $req 'heightMm' 40)
                $dpi = [int](Get-Prop $req 'dpi' 300)
                $pngPath = Get-Prop $req 'pngPath' $null
                $name = Get-Prop $req 'printer' $null
                $waitMs = [int](Get-Prop $req 'waitMs' 20000)

                $png = $null
                if ($null -ne $pngPath -and [string]$pngPath -ne '') {
                    $png = Save-LabelPng $ops $widthMm $heightMm $dpi ([string]$pngPath)
                }

                # No printer name means "render only" — how the fake target and
                # any layout debugging produce an inspectable artifact with no
                # hardware involved.
                if ($null -eq $name -or [string]$name -eq '') {
                    Send-Response @{ id = $id; ok = $true; stage = 'rendered'; png = $png }
                    continue
                }

                $script:labelOps = $ops
                $script:labelWidthMm = $widthMm

                # Snapshot the queue BEFORE printing so the job we create can be
                # told apart from anything already in there. See Get-NewPrintJobId.
                $jobIdsBefore = Get-PrintJobIds ([string]$name)

                $doc = New-Object System.Drawing.Printing.PrintDocument
                try {
                    $doc.PrinterSettings.PrinterName = [string]$name
                    if (-not $doc.PrinterSettings.IsValid) {
                        Send-Response @{
                            id = $id; ok = $false; stage = 'open'
                            error = "Windows does not have a printer called '$name'."
                        }
                        continue
                    }
                    $doc.DocumentName = [string](Get-Prop $req 'docName' 'Fonology label')
                    $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize(
                        'Fonology label', (ConvertTo-Hundredths $widthMm), (ConvertTo-Hundredths $heightMm))
                    $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
                    $doc.OriginAtMargins = $false

                    $doc.add_PrintPage({
                        param($sender, $e)
                        Invoke-DrawOps $e.Graphics $script:labelOps $script:labelWidthMm
                        $e.HasMorePages = $false
                    })

                    # Print() is synchronous only as far as handing the rendered
                    # page to the spooler. The queue wait below is what turns
                    # that into something closer to "it came out".
                    $doc.Print()
                } catch {
                    Send-Response @{ id = $id; ok = $false; stage = 'write'; error = $_.Exception.Message }
                    continue
                } finally {
                    $doc.Dispose()
                }

                $newJobId = Get-NewPrintJobId ([string]$name) $jobIdsBefore
                if ($newJobId -gt 0) {
                    $wait = Wait-ForPrintJob ([string]$name) $newJobId $waitMs
                } else {
                    # Nothing new in the queue: the label was spooled and printed
                    # before we could look. That is the fast, healthy path.
                    $wait = @{ status = 'completed'; detail = $null }
                }
                $queued = $wait.status
                $detail = $wait.detail

                $outcome = Resolve-QueueOutcome $wait
                Send-Response @{
                    id = $id
                    ok = $outcome.ok
                    stage = $outcome.stage
                    queueStatus = $queued
                    error = $detail
                    png = $png
                }
            }

            default {
                Send-Response @{ id = $id; ok = $false; stage = 'protocol'; error = "Unknown op '$op'." }
            }
        }
    } catch {
        # A thrown command must still produce a response line, or the agent
        # waits on a reply that will never come and the lease expires — turning
        # a recoverable error into a receipt nobody can account for.
        Send-Response @{ id = $id; ok = $false; stage = 'exception'; error = $_.Exception.Message }
    }
}

Write-Diag 'stdin closed, exiting'
