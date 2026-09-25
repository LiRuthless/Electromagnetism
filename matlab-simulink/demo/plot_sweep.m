function figFile = plot_sweep(trackName, eMm, psiDeg)
%PLOT_SWEEP 全程扫描曲线 U(s)（§6.5）：固定 e/ψ，车沿中线扫全程，读 4 电感。
% 用法：plot_sweep('track_s_curve', 0, 0)
% 输出：outputs/sweep_<赛道名>.png
if nargin < 1, trackName = 'track_s_curve'; end
if nargin < 2, eMm = 0; end
if nargin < 3, psiDeg = 0; end
ensureRoot();
init(trackName);
TD = evalin('base','TD');
P  = evalin('base','P');

[sArr, U] = em_sweepAlongTrack(TD, P, eMm/1000, psiDeg*pi/180, 0.01);

fig = figure('Visible','off','Position',[100 100 760 480]);
plot(sArr, U(1,:), '-', sArr, U(2,:), '-', sArr, U(3,:), '--', sArr, U(4,:), '--', ...
    'LineWidth', 1.4);
grid on; xlabel('弧长 s (m)'); ylabel('U (Vpp)');
legend(P.sensNames, 'Location','best');
title(sprintf('全程扫描 U(s)（赛道 %s，e = %d mm，\\psi = %d°）', ...
    strrep(TD.name,'_','\_'), round(eMm), round(psiDeg)));

figFile = fullfile(ensureOutDir(), sprintf('sweep_%s.png', TD.name));
print(fig, '-dpng', '-r150', figFile);
close(fig);
fprintf('[demo] 扫描曲线已保存：%s\n', figFile);
end

function ensureRoot()
here = fileparts(mfilename('fullpath'));
root = fileparts(here);
if isempty(which('params'))
    addpath(root, fullfile(root,'track_lib'), fullfile(root,'geom'), ...
        fullfile(root,'field'), fullfile(root,'sensor'), fullfile(root,'control'), ...
        fullfile(root,'blocks'), fullfile(root,'selfcheck'), fullfile(root,'demo'));
end
end

function d = ensureOutDir()
here = fileparts(mfilename('fullpath'));
d = fullfile(fileparts(here), 'outputs');
if ~exist(d,'dir'), mkdir(d); end
end
