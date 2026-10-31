param([int]$Port = 3003)
$ErrorActionPreference = 'Stop'
$script:ViewerLog = Join-Path $env:TEMP 'NeuraLearn-Screen-Viewer.log'
function Write-ViewerLog([string]$Message) { try { Add-Content -LiteralPath $script:ViewerLog -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss')+' '+$Message) } catch {} }
Write-ViewerLog 'Viewer started.'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
# Keep the native viewer visible while hiding the helper console window.
$consoleCode = @"
using System;
using System.Runtime.InteropServices;
public static class NeuraLearnConsoleWindow {
    [DllImport("kernel32.dll")] private static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr handle, int command);
    public static void Hide() { IntPtr handle=GetConsoleWindow(); if(handle!=IntPtr.Zero) ShowWindow(handle,0); }
}
"@
Add-Type -TypeDefinition $consoleCode
[NeuraLearnConsoleWindow]::Hide()

$selectorCode = @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

public sealed class NeuraLearnSelection {
    public Rectangle Bounds { get; set; }
    public Point[] Points { get; set; }
    public bool IsPoint { get; set; }
}

public sealed class NeuraLearnSelector : Form {
    private readonly List<Point> points = new List<Point>();
    private Point start;
    private bool tracking;
    public NeuraLearnSelection Result { get; private set; }

    public NeuraLearnSelector() {
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        Bounds = SystemInformation.VirtualScreen;
        BackColor = Color.FromArgb(67, 52, 126);
        Opacity = 0.20;
        TopMost = true;
        ShowInTaskbar = false;
        Cursor = Cursors.Cross;
        KeyPreview = true;
        DoubleBuffered = true;
    }

    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e);
        using (var box = new SolidBrush(Color.FromArgb(238, 68, 52, 128)))
        using (var text = new SolidBrush(Color.FromArgb(250, 247, 255)))
        using (var font = new Font("Segoe UI", 12, FontStyle.Bold)) {
            e.Graphics.FillRoundedRectangle(box, new Rectangle(24, 24, 420, 72), 16);
            e.Graphics.DrawString("Mark an area or click a point   ·   Esc cancels", font, text, 44, 49);
        }
        if (points.Count > 0) {
        using (var pen = new Pen(Color.FromArgb(255, 64, 224, 208), 5)) {
                pen.StartCap = LineCap.Round; pen.EndCap = LineCap.Round; pen.LineJoin = LineJoin.Round;
                if (points.Count == 1) e.Graphics.DrawEllipse(pen, points[0].X - 26, points[0].Y - 26, 52, 52);
                else e.Graphics.DrawLines(pen, points.ToArray());
            }
        }
    }

    protected override void OnMouseDown(MouseEventArgs e) {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        tracking = true; start = e.Location; points.Clear(); points.Add(e.Location); Invalidate();
    }
    protected override void OnMouseMove(MouseEventArgs e) {
        base.OnMouseMove(e);
        if (!tracking) return;
        if (points.Count == 1 && Math.Abs(e.X-start.X) + Math.Abs(e.Y-start.Y) < 5) return;
        points.Add(e.Location); Invalidate();
    }
    protected override void OnMouseUp(MouseEventArgs e) {
        base.OnMouseUp(e);
        if (!tracking || e.Button != MouseButtons.Left) return;
        tracking = false;
        if (points.Count == 1) points.Add(e.Location);
        bool isPoint = points.Count <= 2 && Math.Abs(e.X-start.X) + Math.Abs(e.Y-start.Y) < 10;
        int minX, minY, maxX, maxY;
        if (isPoint) { minX=e.X-30; minY=e.Y-30; maxX=e.X+30; maxY=e.Y+30; }
        else {
            minX=int.MaxValue; minY=int.MaxValue; maxX=int.MinValue; maxY=int.MinValue;
            foreach (Point p in points) { minX=Math.Min(minX,p.X); minY=Math.Min(minY,p.Y); maxX=Math.Max(maxX,p.X); maxY=Math.Max(maxY,p.Y); }
            if (maxX-minX < 18 || maxY-minY < 18) isPoint=true;
            if (isPoint) { minX=e.X-30; minY=e.Y-30; maxX=e.X+30; maxY=e.Y+30; }
        }
        Result = new NeuraLearnSelection {
            Bounds = new Rectangle(Left+minX, Top+minY, Math.Max(1,maxX-minX), Math.Max(1,maxY-minY)),
            Points = points.ToArray(), IsPoint = isPoint
        };
        DialogResult = DialogResult.OK; Close();
    }
    protected override void OnKeyDown(KeyEventArgs e) {
        base.OnKeyDown(e);
        if (e.KeyCode == Keys.Escape) { DialogResult=DialogResult.Cancel; Close(); }
    }
}

public sealed class NeuraLearnAnimatedButton : Button {
    private readonly Timer animationTimer;
    private int hoverAmount;
    private int hoverTarget;
    private Color baseColor;
    private Color hoverColor;
    private Color textColor;
    private Color borderColor;
    public Color BaseColor { get { return baseColor; } set { baseColor = value; Invalidate(); } }
    public Color HoverColor { get { return hoverColor; } set { hoverColor = value; Invalidate(); } }
    public Color TextColor { get { return textColor; } set { textColor = value; Invalidate(); } }
    public Color BorderColor { get { return borderColor; } set { borderColor = value; Invalidate(); } }

    public NeuraLearnAnimatedButton() {
        baseColor = Color.FromArgb(108, 83, 220);
        hoverColor = Color.FromArgb(143, 117, 245);
        textColor = Color.White;
        borderColor = Color.Transparent;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
        FlatStyle = FlatStyle.Flat;
        FlatAppearance.BorderSize = 0;
        Cursor = Cursors.Hand;
        animationTimer = new Timer { Interval = 14 };
        animationTimer.Tick += (s, e) => {
            if (hoverAmount == hoverTarget) { animationTimer.Stop(); return; }
            hoverAmount += hoverAmount < hoverTarget ? 2 : -2;
            hoverAmount = Math.Max(0, Math.Min(10, hoverAmount));
            Invalidate();
        };
        MouseEnter += (s, e) => { hoverTarget = 10; animationTimer.Start(); };
        MouseLeave += (s, e) => { hoverTarget = 0; animationTimer.Start(); };
        GotFocus += (s, e) => { hoverTarget = 6; animationTimer.Start(); };
        LostFocus += (s, e) => { hoverTarget = 0; animationTimer.Start(); };
    }

    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.Clear(Parent == null ? Color.Transparent : Parent.BackColor);
        int lift = hoverAmount > 0 ? 2 : 0;
        Rectangle bounds = new Rectangle(1, 3 - lift, Math.Max(1, Width - 3), Math.Max(1, Height - 6));
        Color fill = Color.FromArgb(
            BaseColor.R + (HoverColor.R - BaseColor.R) * hoverAmount / 10,
            BaseColor.G + (HoverColor.G - BaseColor.G) * hoverAmount / 10,
            BaseColor.B + (HoverColor.B - BaseColor.B) * hoverAmount / 10);
        using (GraphicsPath path = new GraphicsPath()) {
            int radius = Math.Min(14, Math.Max(4, bounds.Height / 4));
            int d = radius * 2;
            path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
            path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
            path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
            path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            using (LinearGradientBrush brush = new LinearGradientBrush(bounds, fill, HoverColor, LinearGradientMode.Horizontal)) e.Graphics.FillPath(brush, path);
            if (BorderColor.A > 0) using (Pen pen = new Pen(BorderColor, 1)) e.Graphics.DrawPath(pen, path);
        }
        Rectangle textBounds = new Rectangle(bounds.X + 4, bounds.Y, bounds.Width - 8, bounds.Height);
        TextRenderer.DrawText(e.Graphics, Text, Font, textBounds, TextColor,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine);
        if (Focused) ControlPaint.DrawFocusRectangle(e.Graphics, Rectangle.Inflate(bounds, -5, -5));
    }
}

public static class NeuraLearnGdiExtensions {
    public static void FillRoundedRectangle(this Graphics graphics, Brush brush, Rectangle bounds, int radius) {
        using (GraphicsPath path = new GraphicsPath()) {
            int d=radius*2;
            path.AddArc(bounds.X,bounds.Y,d,d,180,90); path.AddArc(bounds.Right-d,bounds.Y,d,d,270,90);
            path.AddArc(bounds.Right-d,bounds.Bottom-d,d,d,0,90); path.AddArc(bounds.X,bounds.Bottom-d,d,d,90,90);
            path.CloseFigure(); graphics.FillPath(brush,path);
        }
    }
}
"@
Add-Type -TypeDefinition $selectorCode -ReferencedAssemblies 'System.Windows.Forms','System.Drawing'

$form = New-Object System.Windows.Forms.Form
$form.Text = 'NeuraLearn  |  Read Screen'
$form.TopMost = $true
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::SizableToolWindow
$form.StartPosition = 'Manual'
$form.ClientSize = New-Object System.Drawing.Size(520, 660)
$form.MinimumSize = New-Object System.Drawing.Size(455, 580)
$form.BackColor = [System.Drawing.Color]::FromArgb(242,238,255)
$form.ForeColor = [System.Drawing.Color]::FromArgb(63,53,102)
$form.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$form.ShowInTaskbar = $true
$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$windowX = [Math]::Max($area.Left, $area.Right-$form.Width-24)
$windowY = [Math]::Max($area.Top, [Math]::Min($area.Top+60, $area.Bottom-$form.Height-12))
$form.Location = New-Object System.Drawing.Point($windowX, $windowY)

$title = New-Object System.Windows.Forms.Label
$title.Text = 'Read Screen'
$title.Font = New-Object System.Drawing.Font('Segoe UI', 17, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::FromArgb(255,255,255)
$title.Dock = [System.Windows.Forms.DockStyle]::Fill
$title.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$title.Margin = New-Object System.Windows.Forms.Padding(0)
$hint = New-Object System.Windows.Forms.Label
$hint.Text = 'Mark anything on your screen and get a clear, contextual explanation.'
$hint.ForeColor = [System.Drawing.Color]::FromArgb(231,224,255)
$hint.Dock = [System.Windows.Forms.DockStyle]::Fill
$hint.TextAlign = [System.Drawing.ContentAlignment]::TopLeft
$hint.Margin = New-Object System.Windows.Forms.Padding(0)
$questionLabel = New-Object System.Windows.Forms.Label
$questionLabel.Text = 'WHAT SHOULD NEURALEARN FOCUS ON?'
$questionLabel.ForeColor = [System.Drawing.Color]::FromArgb(106,87,163)
$questionLabel.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
$questionLabel.Dock = [System.Windows.Forms.DockStyle]::Fill
$questionLabel.TextAlign = [System.Drawing.ContentAlignment]::BottomLeft
$questionLabel.Margin = New-Object System.Windows.Forms.Padding(0,0,0,5)
$question = New-Object System.Windows.Forms.TextBox
$question.Multiline = $true; $question.ScrollBars = 'Vertical'; $question.BorderStyle = 'FixedSingle'
$question.BackColor = [System.Drawing.Color]::FromArgb(255,248,235); $question.ForeColor = [System.Drawing.Color]::FromArgb(71,60,111)
$question.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$question.Dock = [System.Windows.Forms.DockStyle]::Fill
$question.Margin = New-Object System.Windows.Forms.Padding(0,0,0,8)
$selectButton = New-Object NeuraLearnAnimatedButton
$selectButton.Text = '⌖   Select an area anywhere on screen'
$selectButton.BaseColor = [System.Drawing.Color]::FromArgb(0,153,173); $selectButton.HoverColor = [System.Drawing.Color]::FromArgb(34,193,171)
$selectButton.TextColor = [System.Drawing.Color]::White
$selectButton.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$selectButton.Dock = [System.Windows.Forms.DockStyle]::Fill
$selectButton.Margin = New-Object System.Windows.Forms.Padding(0,3,0,6)
$status = New-Object System.Windows.Forms.Label
$status.Text = 'Select an area to begin. Your learning options are ready below.'
$status.ForeColor = [System.Drawing.Color]::FromArgb(104,88,156)
$status.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$status.Dock = [System.Windows.Forms.DockStyle]::Fill
$status.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$status.Margin = New-Object System.Windows.Forms.Padding(0,2,0,4)
$outputLabel = New-Object System.Windows.Forms.Label
$outputLabel.Text = 'SCREEN EXPLANATION'
$outputLabel.ForeColor = [System.Drawing.Color]::FromArgb(54,143,135)
$outputLabel.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
$outputLabel.Dock = [System.Windows.Forms.DockStyle]::Fill
$outputLabel.TextAlign = [System.Drawing.ContentAlignment]::BottomLeft
$outputLabel.Margin = New-Object System.Windows.Forms.Padding(0,0,0,5)
$output = New-Object System.Windows.Forms.TextBox
$output.Multiline = $true; $output.ReadOnly = $true; $output.ScrollBars = 'Vertical'; $output.WordWrap = $true; $output.BorderStyle = 'FixedSingle'
$output.BackColor = [System.Drawing.Color]::FromArgb(229,248,244); $output.ForeColor = [System.Drawing.Color]::FromArgb(41,91,86)
$output.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$output.Text = 'Your explanation will appear here after you mark an area.'
$output.Dock = [System.Windows.Forms.DockStyle]::Fill
$output.Margin = New-Object System.Windows.Forms.Padding(0,0,0,8)
$continueLabel = New-Object System.Windows.Forms.Label
$continueLabel.Text = 'CONTINUE LEARNING'
$continueLabel.ForeColor = [System.Drawing.Color]::FromArgb(91,75,144)
$continueLabel.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
$continueLabel.Dock = [System.Windows.Forms.DockStyle]::Fill
$continueLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$continueLabel.Margin = New-Object System.Windows.Forms.Padding(0,0,0,4)
$textModeButton = New-Object NeuraLearnAnimatedButton
$textModeButton.Text = '💬  Text Chat'; $textModeButton.Visible = $true
$textModeButton.BaseColor = [System.Drawing.Color]::FromArgb(111,83,217); $textModeButton.HoverColor = [System.Drawing.Color]::FromArgb(148,121,244)
$videoModeButton = New-Object NeuraLearnAnimatedButton
$videoModeButton.Text = '▶  Video'; $videoModeButton.Visible = $true
$videoModeButton.BaseColor = [System.Drawing.Color]::FromArgb(238,112,91); $videoModeButton.HoverColor = [System.Drawing.Color]::FromArgb(255,151,124)
$canvasModeButton = New-Object NeuraLearnAnimatedButton
$canvasModeButton.Text = '✎  AI Canvas'; $canvasModeButton.Visible = $true
$canvasModeButton.BaseColor = [System.Drawing.Color]::FromArgb(30,165,147); $canvasModeButton.HoverColor = [System.Drawing.Color]::FromArgb(61,204,178)
foreach($modeButton in @($textModeButton,$videoModeButton,$canvasModeButton)) {
    $modeButton.Enabled=$true
    $modeButton.TextColor = [System.Drawing.Color]::White
    $modeButton.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
    $modeButton.Dock = [System.Windows.Forms.DockStyle]::Fill
    $modeButton.Margin = New-Object System.Windows.Forms.Padding(0,0,7,0)
}

$header = New-Object System.Windows.Forms.TableLayoutPanel
$header.Dock = [System.Windows.Forms.DockStyle]::Fill; $header.BackColor = [System.Drawing.Color]::FromArgb(106,78,211); $header.Padding = New-Object System.Windows.Forms.Padding(22,13,22,7)
$header.ColumnCount = 2; $header.RowCount = 2
$header.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Absolute,48)))
$header.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent,100)))
$header.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,38)))
$header.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent,100)))
$brand = New-Object System.Windows.Forms.Label
$brand.Text = 'N'; $brand.BackColor = [System.Drawing.Color]::FromArgb(255,171,91); $brand.ForeColor = [System.Drawing.Color]::White
$brand.Font = New-Object System.Drawing.Font('Segoe UI', 15, [System.Drawing.FontStyle]::Bold); $brand.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$brand.Dock = [System.Windows.Forms.DockStyle]::Fill; $brand.Margin = New-Object System.Windows.Forms.Padding(0,3,10,3)
$header.Controls.Add($brand,0,0); $header.Controls.Add($title,1,0); $header.Controls.Add($hint,1,1)

$body = New-Object System.Windows.Forms.TableLayoutPanel
$body.Dock = [System.Windows.Forms.DockStyle]::Fill; $body.BackColor = [System.Drawing.Color]::FromArgb(242,238,255); $body.Padding = New-Object System.Windows.Forms.Padding(22,14,22,8)
$body.ColumnCount = 1; $body.RowCount = 6
foreach($row in @(26,78,55,56,28)) { $body.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,$row))) }
$body.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent,100)))
$body.Controls.Add($questionLabel,0,0); $body.Controls.Add($question,0,1); $body.Controls.Add($selectButton,0,2)
$body.Controls.Add($status,0,3); $body.Controls.Add($outputLabel,0,4); $body.Controls.Add($output,0,5)

$modeRow = New-Object System.Windows.Forms.TableLayoutPanel
$modeRow.Dock = [System.Windows.Forms.DockStyle]::Fill; $modeRow.ColumnCount = 3; $modeRow.RowCount = 1
for($column=0;$column -lt 3;$column++) { $modeRow.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent,33.333))) }
$modeRow.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent,100)))
$modeRow.Controls.Add($textModeButton,0,0); $modeRow.Controls.Add($videoModeButton,1,0); $modeRow.Controls.Add($canvasModeButton,2,0)
$footer = New-Object System.Windows.Forms.TableLayoutPanel
$footer.Dock = [System.Windows.Forms.DockStyle]::Fill; $footer.BackColor = [System.Drawing.Color]::FromArgb(230,224,255); $footer.Padding = New-Object System.Windows.Forms.Padding(22,7,15,12)
$footer.ColumnCount = 1; $footer.RowCount = 2
$footer.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,24)))
$footer.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent,100)))
$footer.Controls.Add($continueLabel,0,0); $footer.Controls.Add($modeRow,0,1)

$layout = New-Object System.Windows.Forms.TableLayoutPanel
$layout.Dock = [System.Windows.Forms.DockStyle]::Fill; $layout.ColumnCount = 1; $layout.RowCount = 3
$layout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,95)))
$layout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent,100)))
$layout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute,96)))
$layout.Controls.Add($header,0,0); $layout.Controls.Add($body,0,1); $layout.Controls.Add($footer,0,2)
$form.Controls.Add($layout)
$textModeButton.Add_Click({ Start-ReadScreenMode 'chat' })
$videoModeButton.Add_Click({ Start-ReadScreenMode 'video' })
$canvasModeButton.Add_Click({ Start-ReadScreenMode 'canvas' })
function Start-ReadScreenMode([string]$Mode) {
    if($script:ReadScreenAnalysisTask -and -not $script:ReadScreenAnalysisTask.IsCompleted) { $status.Text='Still reading that area. The choices will work as soon as the explanation is ready.'; return }
    if(-not $script:ReadScreenSessionId) { $status.Text='Mark an area first, then choose one of these learning modes.'; return }
    try {
        $payload=@{sessionId=$script:ReadScreenSessionId;mode=$Mode} | ConvertTo-Json -Compress
        $null=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/read-screen/choose" -Method Post -ContentType 'application/json' -Body $payload -TimeoutSec 8
        $textModeButton.Enabled=$true; $videoModeButton.Enabled=$true; $canvasModeButton.Enabled=$true
        $label=@{chat='Text Chat';video='Video Explainer';canvas='Canvas Tutor'}[$Mode]
        $status.Text="NeuraLearn is opening $label. The viewer is minimized so you can see it."
        $form.WindowState=[System.Windows.Forms.FormWindowState]::Minimized
    } catch {
        $textModeButton.Enabled=$true; $videoModeButton.Enabled=$true; $canvasModeButton.Enabled=$true
        $statusCode=0
        try { $statusCode=[int]$_.Exception.Response.StatusCode } catch {}
        if($statusCode -eq 503) {
            try {
                $url="http://127.0.0.1:$Port/?readScreen=$($script:ReadScreenSessionId)&mode=$Mode#$Mode"
                Start-Process $url
                $textModeButton.Enabled=$true; $videoModeButton.Enabled=$true; $canvasModeButton.Enabled=$true
                $status.Text="Opening $label in a NeuraLearn tab. The viewer is minimized."
                $form.WindowState=[System.Windows.Forms.FormWindowState]::Minimized
            } catch { $status.Text='Could not open the NeuraLearn page.'; $output.Text=$_.Exception.Message }
        } else {
            $status.Text='Could not send this selection to NeuraLearn.'; $output.Text=$_.Exception.Message
        }
    }
}

$script:ReadScreenAnalysisTask=$null
$script:ReadScreenAnalysisClient=$null
$script:ReadScreenAnalysisContent=$null
$analysisTimer=New-Object System.Windows.Forms.Timer
$analysisTimer.Interval=250
$analysisTimer.Add_Tick({
    if($null -eq $script:ReadScreenAnalysisTask -or -not $script:ReadScreenAnalysisTask.IsCompleted) { return }
    $analysisTimer.Stop()
    try {
        $httpResponse=$script:ReadScreenAnalysisTask.GetAwaiter().GetResult()
        $responseText=$httpResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if(-not $httpResponse.IsSuccessStatusCode) {
            $errorData=$responseText | ConvertFrom-Json -ErrorAction SilentlyContinue
            $errorMessage=[string]$errorData.error
            if(-not $errorMessage){$errorMessage="Screen analysis failed with HTTP $([int]$httpResponse.StatusCode)."}
            throw [System.Exception]::new($errorMessage)
        }
        $response=$responseText | ConvertFrom-Json
        $output.Text=([string]$response.explanation + "`r`n`r`nContext: " + [string]$response.context).Trim()
        if(-not $response.sessionId){throw 'NeuraLearn did not return a screen selection ID. Please mark the area again.'}
        $script:ReadScreenSessionId=[string]$response.sessionId
        $textModeButton.Visible=$true; $videoModeButton.Visible=$true; $canvasModeButton.Visible=$true
        $textModeButton.Enabled=$true; $videoModeButton.Enabled=$true; $canvasModeButton.Enabled=$true
        $status.Text='Choose how you want NeuraLearn to continue with this marked area.'
        Write-ViewerLog 'Screen analysis completed; mode choices enabled.'
    } catch {
        $status.Text='Could not read that screen area.'
        $output.Text=$_.Exception.Message
        $script:ReadScreenSessionId=$null
        $textModeButton.Visible=$true; $videoModeButton.Visible=$true; $canvasModeButton.Visible=$true
        $textModeButton.Enabled=$true; $videoModeButton.Enabled=$true; $canvasModeButton.Enabled=$true
        Write-ViewerLog ('Screen analysis failed: '+$_.Exception.Message)
    } finally {
        if($script:ReadScreenAnalysisContent){$script:ReadScreenAnalysisContent.Dispose();$script:ReadScreenAnalysisContent=$null}
        if($script:ReadScreenAnalysisClient){$script:ReadScreenAnalysisClient.Dispose();$script:ReadScreenAnalysisClient=$null}
        $script:ReadScreenAnalysisTask=$null
    }
})

$selectButton.Add_Click({
    Write-ViewerLog 'Area selection started.'
    $script:ReadScreenSessionId=$null
    $textModeButton.Visible=$true; $videoModeButton.Visible=$true; $canvasModeButton.Visible=$true
    $textModeButton.Enabled=$true; $videoModeButton.Enabled=$true; $canvasModeButton.Enabled=$true
    $form.Hide()
    try {
        $selection = [NeuraLearnSelector]::new()
        $dialogResult = $selection.ShowDialog()
        if ($dialogResult -ne [System.Windows.Forms.DialogResult]::OK -or $null -eq $selection.Result) {
            $form.Show(); $form.TopMost=$true; $status.Text='Selection cancelled. Click Select to try again.'
            Write-ViewerLog 'Area selection cancelled.'
            return
        }
        $virtual = [System.Windows.Forms.SystemInformation]::VirtualScreen
        $padding=150; $r=$selection.Result.Bounds
        $left=[Math]::Max($virtual.Left,$r.Left-$padding); $top=[Math]::Max($virtual.Top,$r.Top-$padding)
        $right=[Math]::Min($virtual.Right,$r.Right+$padding); $bottom=[Math]::Min($virtual.Bottom,$r.Bottom+$padding)
        $width=[Math]::Max(1,$right-$left); $height=[Math]::Max(1,$bottom-$top)
        $bitmap=New-Object System.Drawing.Bitmap($width,$height,[System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($left,$top,0,0,$bitmap.Size,[System.Drawing.CopyPixelOperation]::SourceCopy)
        $pen=New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255,64,224,208),5)
        $pen.StartCap=[System.Drawing.Drawing2D.LineCap]::Round; $pen.EndCap=[System.Drawing.Drawing2D.LineCap]::Round; $pen.LineJoin=[System.Drawing.Drawing2D.LineJoin]::Round
        $points=@($selection.Result.Points)
        if ($selection.Result.IsPoint) {
            $x=$selection.Result.Bounds.Left + $selection.Result.Bounds.Width/2 - $left; $y=$selection.Result.Bounds.Top + $selection.Result.Bounds.Height/2 - $top
            $graphics.DrawEllipse($pen,[single]($x-25),[single]($y-25),[single]50,[single]50)
            $brush=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,64,224,208)); $graphics.FillEllipse($brush,[single]($x-4),[single]($y-4),[single]8,[single]8); $brush.Dispose()
        } elseif ($points.Count -gt 1) {
            $local=New-Object 'System.Drawing.Point[]' $points.Count
            for($i=0;$i -lt $points.Count;$i++){$local[$i]=New-Object System.Drawing.Point(($virtual.Left+$points[$i].X-$left),($virtual.Top+$points[$i].Y-$top))}
            $graphics.DrawLines($pen,$local)
        }
        $pen.Dispose(); $graphics.Dispose()
        $memory=New-Object System.IO.MemoryStream
        $bitmap.Save($memory,[System.Drawing.Imaging.ImageFormat]::Jpeg)
        $image='data:image/jpeg;base64,'+[Convert]::ToBase64String($memory.ToArray())
        $memory.Dispose(); $bitmap.Dispose()
        $payload=@{image=$image;question=$question.Text.Trim();hasMarks=$true} | ConvertTo-Json -Depth 4 -Compress
        $form.Show(); $form.TopMost=$true; $form.Activate()
        $status.Text='Reading your selection… The three options are shown below.'
        $output.Text='NeuraLearn is analyzing the marked area. You can resize or move this window while it works.'
        $form.Refresh()
        Add-Type -AssemblyName System.Net.Http
        $script:ReadScreenAnalysisClient=New-Object System.Net.Http.HttpClient
        $script:ReadScreenAnalysisClient.Timeout=[TimeSpan]::FromSeconds(65)
        $script:ReadScreenAnalysisContent=[System.Net.Http.StringContent]::new($payload,[System.Text.Encoding]::UTF8,'application/json')
        $script:ReadScreenAnalysisTask=$script:ReadScreenAnalysisClient.PostAsync("http://127.0.0.1:$Port/api/read-screen",$script:ReadScreenAnalysisContent)
        $analysisTimer.Start()
        Write-ViewerLog "Screenshot submitted for analysis ($width x $height)."
    } catch {
        if(-not $form.Visible){$form.Show()}; $form.TopMost=$true
        $status.Text='Could not read that screen area.'; $output.Text=$_.Exception.Message
        $script:ReadScreenSessionId=$null
        $textModeButton.Visible=$true; $videoModeButton.Visible=$true; $canvasModeButton.Visible=$true
        $textModeButton.Enabled=$true; $videoModeButton.Enabled=$true; $canvasModeButton.Enabled=$true
        if($script:ReadScreenAnalysisContent){$script:ReadScreenAnalysisContent.Dispose();$script:ReadScreenAnalysisContent=$null}
        if($script:ReadScreenAnalysisClient){$script:ReadScreenAnalysisClient.Dispose();$script:ReadScreenAnalysisClient=$null}
        Write-ViewerLog ('Selection processing failed: '+$_.Exception.Message)
    }
})
[void]$form.ShowDialog()
