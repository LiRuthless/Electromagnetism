function init(trackName, Poverride)
%INIT 初始化 base 工作区变量：参数 P + 赛道数据 TD。
%   init                 默认参数 + 默认赛道
%   init('track_xxx')    切换赛道（track_lib/ 中的函数名）
%   init([], P)          使用自定义参数结构体（先 P = params; 再改字段）
%   init('track_xxx', P) 两者都指定
%
% Simulink 模型的 InitFcn 回调会在 P/TD 缺失时自动调用本函数。
% 改参数的标准流程：P = params; P.kp = 0.8; init([], P); 然后 sim。

root = fileparts(mfilename('fullpath'));
addpath(root, fullfile(root,'track_lib'), fullfile(root,'geom'), ...
    fullfile(root,'field'), fullfile(root,'sensor'), fullfile(root,'control'), ...
    fullfile(root,'blocks'), fullfile(root,'selfcheck'), fullfile(root,'demo'));

if nargin >= 2 && ~isempty(Poverride)
    P = Poverride;
else
    P = params();
end
if nargin >= 1 && ~isempty(trackName)
    P.trackName = trackName;
end

TD = build_track_data(P.trackName, P);

% 初始位姿（§8.5：起点中线处 + e/ψ 扰动；e>0 右偏，ψ>0 右偏/顺时针）
[p0x, p0y, t0x, t0y] = em_pointAtLength(TD.path, 0);
TD.x0     = p0x + P.initE * t0y;
TD.y0     = p0y - P.initE * t0x;
TD.theta0 = atan2(t0y, t0x) + P.initPsi;

% 电机滞后精确更新系数（式 8.7）：alpha = exp(-dt/tau)；tau=0 时 0（瞬时跟随）
if P.tauS > 0
    TD.alpha = exp(-P.dt / P.tauS);
else
    TD.alpha = 0;
end

% 完赛弧长（式 8.10）：闭环赛道 = 单圈总长；非闭环 = 总长 + 0.5 m
if TD.closed
    TD.finishDist = TD.length;
else
    TD.finishDist = TD.length + P.finishTol;
end
TD.sensMat = P.sensMat;

assignin('base', 'P', P);
assignin('base', 'TD', TD);

fprintf('[init] 赛道 %s（%s），总长 %.3f m，完赛弧长 %.3f m，k = %.3e V/T\n', ...
    TD.name, ternary(TD.closed,'闭环','非闭环'), TD.length, TD.finishDist, P.k);
end

function s = ternary(c, a, b)
if c, s = a; else, s = b; end
end
